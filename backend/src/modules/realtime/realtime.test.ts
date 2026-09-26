import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DASHBOARD_CHANGED_EVENT,
  REALTIME_PATH,
  slugify,
  WEB_ORDERS_CHANGED_EVENT,
} from '@panesypan/shared';
import request from 'supertest';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../../../test/database';
import {
  createTestUser,
  DEFAULT_PASSWORD,
  initModels,
  login,
  readCookie,
  resetDatabase,
  type LoggedIn,
} from '../../../test/factories';
import { createTestEnv, silentLogger } from '../../../test/helpers';
import { createApp } from '../../app';
import { authConfigFromEnv } from '../auth/auth.config';
import { SessionModel } from '../auth/session.model';
import { CategoryModel, ProductModel } from '../catalog/catalog.models';
import { createRealtime, type Realtime } from './realtime';

const ORIGIN = 'http://localhost:5173';
const env = createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' });
const app = createApp(env, silentLogger);

let stopDatabase: (() => Promise<void>) | undefined;
let server: Server;
let realtime: Realtime;
let url: string;
let cashier: LoggedIn;
let breadId: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
  server = createServer(app);
  realtime = createRealtime(server, {
    env,
    authConfig: authConfigFromEnv(env),
    logger: silentLogger,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await realtime.close();
  await stopDatabase?.();
});

beforeEach(async () => {
  await resetDatabase();
  await createTestUser({ username: 'admin', role: 'ADMIN' });
  await createTestUser({ username: 'laura', role: 'CASHIER' });
  cashier = await login(app, 'laura', DEFAULT_PASSWORD);
  const bakery = await CategoryModel.create({ name: 'Panadería', slug: 'panaderia' });
  const bread = await ProductModel.create({
    name: 'Pan',
    slug: slugify('Pan'),
    categoryId: bakery._id,
    price: 2_000,
  });
  breadId = bread.id;
});

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});

async function accessCookieOf(username: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ identifier: username, password: DEFAULT_PASSWORD });
  return `pyp_at=${readCookie(response, 'pyp_at')}`;
}

function open(cookie: string | null, origin: string | null = ORIGIN): Socket {
  const headers: Record<string, string> = {};
  if (cookie !== null) headers.cookie = cookie;
  if (origin !== null) headers.origin = origin;
  const socket = connect(url, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    extraHeaders: headers,
    reconnection: false,
  });
  sockets.push(socket);
  return socket;
}

const connected = (socket: Socket) =>
  new Promise<'connected' | 'rejected'>((resolve) => {
    socket.on('connect', () => resolve('connected'));
    socket.on('connect_error', () => resolve('rejected'));
  });

describe('tiempo real', () => {
  it('rechaza las conexiones sin sesión', async () => {
    expect(await connected(open(null))).toBe('rejected');
  });

  it('la cajera recibe los pedidos web pero no los avisos del dashboard', async () => {
    const socket = open(await accessCookieOf('laura'));
    expect(await connected(socket)).toBe('connected');
    let dashboard = false;
    socket.on(DASHBOARD_CHANGED_EVENT, () => {
      dashboard = true;
    });
    const changed = new Promise<void>((resolve) => {
      socket.on(WEB_ORDERS_CHANGED_EVENT, () => resolve());
    });
    await cashier.agent
      .post('/api/v1/cash-shifts')
      .set('X-CSRF-Token', cashier.csrfToken)
      .send({ openingAmount: 50_000 })
      .expect(201);
    await request(app)
      .post('/api/v1/public/pedidos')
      .set('Origin', ORIGIN)
      .send({
        clientRequestId: randomUUID(),
        customer: {
          name: 'Ana Gómez',
          phone: '3001234567',
          address: 'Cra 16 # 40-20',
          neighborhood: 'Los Molinos',
          note: '',
        },
        confirmsDosquebradas: true,
        lines: [{ productId: breadId, quantity: 1 }],
      })
      .expect(201);
    await expect(changed).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(dashboard).toBe(false);
  });

  it('rechaza un origen no permitido', async () => {
    expect(await connected(open(await accessCookieOf('admin'), 'https://otro-sitio.com'))).toBe(
      'rejected',
    );
  });

  it('rechaza si la sesión fue cerrada', async () => {
    const cookie = await accessCookieOf('admin');
    await SessionModel.updateMany({}, { $set: { revokedAt: new Date() } });
    expect(await connected(open(cookie))).toBe('rejected');
  });

  it('avisa al administrador cuando la cajera cobra una venta', async () => {
    const socket = open(await accessCookieOf('admin'));
    expect(await connected(socket)).toBe('connected');
    const changed = new Promise<void>((resolve) => {
      socket.on(DASHBOARD_CHANGED_EVENT, () => resolve());
    });

    await cashier.agent
      .post('/api/v1/cash-shifts')
      .set('X-CSRF-Token', cashier.csrfToken)
      .send({ openingAmount: 50_000 })
      .expect(201);
    await cashier.agent
      .post('/api/v1/sales/checkout')
      .set('X-CSRF-Token', cashier.csrfToken)
      .send({
        clientRequestId: randomUUID(),
        lines: [{ productId: breadId, quantity: 1 }],
        expectedTotal: 2_000,
        payments: [{ method: 'CASH', amount: 2_000 }],
      })
      .expect(201);

    await expect(changed).resolves.toBeUndefined();
  });
});
