import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  createWebOrderResponseSchema,
  isInDeliveryZone,
  listWebOrdersResponseSchema,
  OUT_OF_ZONE_MESSAGE,
  webOrderResponseSchema,
} from '@panesypan/shared';
import type { Express } from 'express';
import type { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../../../test/database';
import {
  createTestUser,
  DEFAULT_PASSWORD,
  initModels,
  login,
  resetDatabase,
  type LoggedIn,
} from '../../../test/factories';
import { createTestEnv, silentLogger } from '../../../test/helpers';
import { createApp } from '../../app';
import { AuditLogModel } from '../audit/audit-log.model';
import { CategoryModel, ProductModel } from '../catalog/catalog.models';
import { WebOrderModel } from './web-order.model';

const ORIGIN = 'http://localhost:5173';
const env = createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' });
let app: Express;
const errorOf = (body: unknown) => apiErrorResponseSchema.parse(body).error;
const numberOf = (body: unknown) => createWebOrderResponseSchema.parse(body).order.number;

let stopDatabase: (() => Promise<void>) | undefined;
let bread: Types.ObjectId;
let seq = 0;

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
  await WebOrderModel.init();
});

afterAll(async () => {
  await stopDatabase?.();
});

beforeEach(async () => {
  app = createApp(env, silentLogger); // limitador nuevo en cada prueba
  await resetDatabase();
  await WebOrderModel.deleteMany({});
  const bakery = await category('Panadería');
  bread = (await product('Pan Coco', bakery._id, { price: 800 }))._id;
});

async function category(name: string, extra: Record<string, unknown> = {}) {
  seq += 1;
  return CategoryModel.create({ name, slug: `cat-${String(seq)}`, ...extra });
}
async function product(
  name: string,
  categoryId: Types.ObjectId,
  extra: Record<string, unknown> = {},
) {
  seq += 1;
  return ProductModel.create({
    name,
    slug: `prod-${String(seq)}`,
    categoryId,
    price: 1_000,
    ...extra,
  });
}

function orderBody(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: randomUUID(),
    customer: {
      name: 'Ana Gómez',
      phone: '3001234567',
      address: 'Cra 16 # 40-20',
      neighborhood: 'Los Molinos',
      note: 'Tocar el timbre',
    },
    confirmsDosquebradas: true,
    lines: [{ productId: bread.toString(), quantity: 2 }],
    ...overrides,
  };
}

const postOrder = (body: unknown) =>
  request(app)
    .post('/api/v1/public/pedidos')
    .set('Origin', ORIGIN)
    .send(body as object);

async function loginAs(role: 'ADMIN' | 'CASHIER'): Promise<LoggedIn> {
  const username = `u${role.toLowerCase()}`;
  await createTestUser({ username, role });
  return login(app, username, DEFAULT_PASSWORD);
}

describe('POST /public/pedidos', () => {
  it('crea el pedido con los precios de la BD', async () => {
    const response = await postOrder(orderBody());
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const { order } = createWebOrderResponseSchema.parse(response.body);
    expect(order).toMatchObject({
      number: 1,
      status: 'PENDING',
      subtotal: 1_600,
      deliveryFee: null,
      total: 1_600,
    });
    expect(order.lines[0]).toMatchObject({ name: 'Pan Coco', unitPrice: 800, total: 1_600 });
    expect(response.body).not.toHaveProperty('order.customer');
    expect(numberOf((await postOrder(orderBody())).body)).toBe(2);
  });

  it('rechaza un precio enviado por el cliente (esquema estricto)', async () => {
    const body = orderBody({
      lines: [{ productId: bread.toString(), quantity: 1, price: 1 }],
    });
    expect((await postOrder(body)).status).toBe(400);
    expect((await postOrder({ ...orderBody(), total: 1 })).status).toBe(400);
    expect(await WebOrderModel.countDocuments()).toBe(0);
  });

  it.each([
    ['oculto en la web', { isVisibleOnline: false }],
    ['agotado', { isAvailable: false }],
    ['archivado', { isActive: false }],
  ])('producto %s → 409', async (_label, extra) => {
    const bakery = await category('Otra');
    const item = await product('Mogolla', bakery._id, extra);
    const response = await postOrder(orderBody({ lines: [{ productId: item.id, quantity: 1 }] }));
    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('OUT_OF_STOCK');
    expect(errorOf(response.body).message).toContain('Mogolla');
  });

  it('almuerzos y categorías inactivas → 409', async () => {
    const lunch = await product('Almuerzo', (await category('Almuerzos', { kind: 'LUNCH' }))._id);
    const old = await product('Viejo', (await category('Vieja', { isActive: false }))._id);
    for (const item of [lunch, old]) {
      const response = await postOrder(orderBody({ lines: [{ productId: item.id, quantity: 1 }] }));
      expect(response.status).toBe(409);
    }
  });

  it('con la lista de barrios vacía exige confirmar Dosquebradas', async () => {
    const response = await postOrder(orderBody({ confirmsDosquebradas: false }));
    expect(response.status).toBe(400);
    expect(errorOf(response.body).message).toBe(OUT_OF_ZONE_MESSAGE);
    const { confirmsDosquebradas: _omit, ...withoutFlag } = orderBody();
    expect((await postOrder(withoutFlag)).status).toBe(400);
  });

  it('con lista de barrios, un barrio fuera de ella no está en la zona', () => {
    const list = ['Los Molinos', 'Guadalupe'];
    expect(
      isInDeliveryZone({ neighborhood: 'Los Molinos', confirmsDosquebradas: false }, list),
    ).toBe(true);
    expect(isInDeliveryZone({ neighborhood: 'Cuba', confirmsDosquebradas: true }, list)).toBe(
      false,
    );
  });

  it('valida teléfono y datos del cliente', async () => {
    const body = orderBody();
    body.customer.phone = '6001234567';
    expect((await postOrder(body)).status).toBe(400);
  });

  it('es idempotente por clientRequestId', async () => {
    const body = orderBody();
    const first = await postOrder(body);
    const second = await postOrder(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(numberOf(second.body)).toBe(numberOf(first.body));
    expect(await WebOrderModel.countDocuments()).toBe(1);
  });

  it('limita a 5 pedidos cada 10 minutos por IP', async () => {
    for (let i = 0; i < 5; i += 1) expect((await postOrder(orderBody())).status).toBe(201);
    const response = await postOrder(orderBody());
    expect(response.status).toBe(429);
    expect(errorOf(response.body).code).toBe('RATE_LIMITED');
  });
});

describe('panel de pedidos web', () => {
  it('la cajera lista los pedidos y avanza el estado solo al siguiente', async () => {
    await postOrder(orderBody());
    const cashier = await loginAs('CASHIER');
    const list = await cashier.agent.get('/api/v1/web-orders').expect(200);
    const [order] = listWebOrdersResponseSchema.parse(list.body).orders;
    if (order === undefined) throw new Error('Sin pedido');
    expect(order.customer.phone).toBe('3001234567');

    const patch = (status: string) =>
      cashier.agent
        .patch(`/api/v1/web-orders/${order.id}/status`)
        .set('X-CSRF-Token', cashier.csrfToken)
        .send({ status });

    expect((await patch('DISPATCHED')).status).toBe(409);
    const confirmed = await patch('CONFIRMED');
    expect(confirmed.status).toBe(200);
    expect(webOrderResponseSchema.parse(confirmed.body).order.status).toBe('CONFIRMED');
    expect((await patch('PENDING')).status).toBe(409);
    expect((await patch('DISPATCHED')).status).toBe(200);
    expect((await patch('DELIVERED')).status).toBe(200);
    expect((await patch('DELIVERED')).status).toBe(409);

    const filtered = await cashier.agent.get('/api/v1/web-orders?status=PENDING').expect(200);
    expect(listWebOrdersResponseSchema.parse(filtered.body).orders).toHaveLength(0);

    const audits = await AuditLogModel.find({ action: 'WEB_ORDER_STATUS_CHANGED' }).lean();
    expect(audits).toHaveLength(3);
    expect(audits.map((audit) => audit.metadata)).toContainEqual({
      number: 1,
      from: 'PENDING',
      to: 'CONFIRMED',
    });
    const stored = await WebOrderModel.findById(order.id);
    expect(stored?.statusHistory.map((change) => change.status)).toEqual([
      'PENDING',
      'CONFIRMED',
      'DISPATCHED',
      'DELIVERED',
    ]);
  });

  it('exige sesión', async () => {
    expect((await request(app).get('/api/v1/web-orders')).status).toBe(401);
  });

  it('el administrador también puede verlos', async () => {
    const admin = await loginAs('ADMIN');
    expect((await admin.agent.get('/api/v1/web-orders')).status).toBe(200);
  });
});
