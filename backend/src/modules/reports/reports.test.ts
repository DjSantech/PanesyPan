import { randomUUID } from 'node:crypto';
import { dashboardSummarySchema, slugify, toBusinessDate } from '@panesypan/shared';
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

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);

// El BOM que Excel necesita para leer bien las tildes.
const BOM = String.fromCharCode(0xfeff);

let stopDatabase: (() => Promise<void>) | undefined;
let admin: LoggedIn;
let cashier: LoggedIn;
let breadId: string;
let cakeId: string;

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
});

afterAll(async () => {
  await stopDatabase?.();
});

beforeEach(async () => {
  await resetDatabase();
  await createTestUser({ username: 'admin', role: 'ADMIN' });
  await createTestUser({ username: 'laura', name: 'Laura Gómez', role: 'CASHIER' });
  admin = await login(app, 'admin', DEFAULT_PASSWORD);
  cashier = await login(app, 'laura', DEFAULT_PASSWORD);
  const bakery = await CategoryModel.create({ name: 'Panadería', slug: 'panaderia' });
  const bread = await ProductModel.create({
    name: 'Pan de bono',
    slug: slugify('Pan de bono'),
    categoryId: bakery._id,
    price: 2_000,
    trackStock: true,
  });
  const cake = await ProductModel.create({
    name: '=Torta',
    slug: slugify('Torta'),
    categoryId: bakery._id,
    price: 5_000,
  });
  breadId = bread.id;
  cakeId = cake.id;
});

const send = (who: LoggedIn, method: 'post' | 'patch', path: string, body?: object) =>
  who.agent[method](`/api/v1${path}`).set('X-CSRF-Token', who.csrfToken).send(body);

/** Deja la caja de Laura abierta con 10 panes en existencia y dos ventas hechas. */
async function seedDay(): Promise<void> {
  await send(cashier, 'post', '/cash-shifts', { openingAmount: 100_000 }).expect(201);
  await send(admin, 'post', '/inventory/production', { productId: breadId, quantity: 10 }).expect(
    201,
  );
  await send(admin, 'patch', `/inventory/${breadId}/min-stock`, { minStock: 8 }).expect(200);
  await send(cashier, 'post', '/sales/checkout', {
    clientRequestId: randomUUID(),
    lines: [{ productId: breadId, quantity: 3 }],
    expectedTotal: 6_000,
    payments: [{ method: 'CASH', amount: 6_000 }],
  }).expect(201);
  await send(cashier, 'post', '/sales/checkout', {
    clientRequestId: randomUUID(),
    lines: [{ productId: cakeId, quantity: 1 }],
    expectedTotal: 5_000,
    payments: [{ method: 'NEQUI', amount: 5_000 }],
  }).expect(201);
  await send(cashier, 'post', '/cash-shifts/current/movements', {
    type: 'EXPENSE',
    amount: 12_000,
    reason: 'Hielo',
  }).expect(201);
}

describe('GET /reports/dashboard', () => {
  it('solo lo ve quien tiene permiso de reportes', async () => {
    await cashier.agent.get('/api/v1/reports/dashboard').expect(403);
    await admin.agent.get('/api/v1/reports/dashboard').expect(200);
  });

  it('exige sesión', async () => {
    const { default: request } = await import('supertest');
    await request(app).get('/api/v1/reports/dashboard').expect(401);
  });

  it('un día sin movimiento devuelve ceros y las 24 horas', async () => {
    const response = await admin.agent.get('/api/v1/reports/dashboard').expect(200);
    const summary = dashboardSummarySchema.parse(response.body);
    expect(summary.businessDate).toBe(toBusinessDate());
    expect(summary.sales).toEqual({
      count: 0,
      total: 0,
      average: 0,
      discountsTotal: 0,
      voidedCount: 0,
    });
    expect(summary.byHour).toHaveLength(24);
    expect(summary.byMethod).toEqual([]);
    expect(summary.cash.openShifts).toEqual([]);
    expect(summary.inventory.lowStockCount).toBe(0);
  });

  it('resume ventas, medios de pago, caja e inventario del día', async () => {
    await seedDay();
    const response = await admin.agent.get('/api/v1/reports/dashboard').expect(200);
    const summary = dashboardSummarySchema.parse(response.body);

    expect(summary.sales).toMatchObject({ count: 2, total: 11_000, average: 5_500 });
    expect(summary.byHour.reduce((sum, hour) => sum + hour.total, 0)).toBe(11_000);
    expect(summary.byMethod).toEqual([
      { method: 'CASH', amount: 6_000, count: 1 },
      { method: 'NEQUI', amount: 5_000, count: 1 },
    ]);
    expect(summary.topProducts[0]).toMatchObject({ name: 'Pan de bono', quantity: 3 });

    expect(summary.cash.openShifts).toHaveLength(1);
    expect(summary.cash.openShifts[0]).toMatchObject({
      userName: 'Laura Gómez',
      salesTotal: 11_000,
      expensesTotal: 12_000,
      // base 100.000 + efectivo 6.000 − egreso 12.000
      expectedCash: 94_000,
    });
    expect(summary.cash.expectedCashTotal).toBe(94_000);
    expect(summary.cash.expensesTotal).toBe(12_000);

    // 10 producidos − 3 vendidos = 7, y el mínimo es 8.
    expect(summary.inventory).toMatchObject({
      trackedCount: 1,
      lowStockCount: 1,
      producedToday: 10,
    });
    expect(summary.inventory.lowStock).toEqual([
      { productId: breadId, name: 'Pan de bono', quantity: 7, minStock: 8 },
    ]);
  });

  it('las ventas anuladas dejan de sumar y se cuentan aparte', async () => {
    await seedDay();
    const list = await cashier.agent.get('/api/v1/sales').expect(200);
    const first = (list.body as { items: { id: string; total: number }[] }).items.find(
      (sale) => sale.total === 5_000,
    );
    await createTestUser({ username: 'boss', role: 'ADMIN', pin: '731940' });
    await send(cashier, 'post', `/sales/${first?.id ?? ''}/void`, {
      reason: 'Cliente se arrepintió',
      approverPin: '731940',
    }).expect(200);

    const summary = dashboardSummarySchema.parse(
      (await admin.agent.get('/api/v1/reports/dashboard').expect(200)).body,
    );
    expect(summary.sales).toMatchObject({ count: 1, total: 6_000, voidedCount: 1 });
  });
});

describe('GET /reports/export/:kind', () => {
  const today = () => toBusinessDate();
  const range = () => `?from=${today()}&to=${today()}`;

  it('la cajera no puede exportar', async () => {
    await cashier.agent.get(`/api/v1/reports/export/sales${range()}`).expect(403);
  });

  it('exporta las ventas en CSV con BOM y punto y coma', async () => {
    await seedDay();
    const response = await admin.agent.get(`/api/v1/reports/export/sales${range()}`).expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain(
      `panesypan-ventas-${today()}_${today()}.csv`,
    );
    const text = response.text;
    expect(text.startsWith(BOM + 'Tiquete;Fecha;Hora;')).toBe(true);
    const lines = text.trim().split(String.fromCharCode(13, 10));
    expect(lines).toHaveLength(3);
    expect(lines.join(' ')).toContain('Efectivo 6000');
    expect(lines.join(' ')).toContain('Nequi 5000');
  });

  it('exporta cajas e inventario', async () => {
    await seedDay();
    const cash = await admin.agent.get(`/api/v1/reports/export/cash${range()}`).expect(200);
    expect(cash.text).toContain('Laura Gómez');
    const inventory = await admin.agent
      .get(`/api/v1/reports/export/inventory${range()}`)
      .expect(200);
    expect(inventory.text).toContain('Producción');
    expect(inventory.text).toContain('Venta');
  });

  it('valida el rango y el tipo de reporte', async () => {
    await admin.agent.get('/api/v1/reports/export/sales').expect(400);
    await admin.agent.get('/api/v1/reports/export/sales?from=2026-09-10&to=2026-09-01').expect(400);
    await admin.agent.get('/api/v1/reports/export/sales?from=2026-01-01&to=2026-09-01').expect(400);
    await admin.agent.get(`/api/v1/reports/export/otra${range()}`).expect(404);
  });

  it('deja constancia en la auditoría', async () => {
    await admin.agent.get(`/api/v1/reports/export/sales${range()}`).expect(200);
    expect(await AuditLogModel.countDocuments({ action: 'REPORT_EXPORTED' })).toBe(1);
  });
});
