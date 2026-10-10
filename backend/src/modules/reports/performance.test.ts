import { randomUUID } from 'node:crypto';
import {
  cashShiftDetailSchema,
  listSalesResponseSchema,
  performanceReportSchema,
  slugify,
  toBusinessDate,
} from '@panesypan/shared';
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
import { CategoryModel, ProductModel } from '../catalog/catalog.models';

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);

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
    cost: 800,
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

const today = () => toBusinessDate();
const range = () => `?from=${today()}&to=${today()}`;
const CRLF = String.fromCharCode(13, 10);

async function shiftId(): Promise<string> {
  const response = await admin.agent.get(`/api/v1/cash-shifts${range()}`).expect(200);
  return (response.body as { items: { id: string }[] }).items[0]?.id ?? '';
}

async function voidCake(): Promise<void> {
  const list = listSalesResponseSchema.parse(
    (await cashier.agent.get('/api/v1/sales').expect(200)).body,
  );
  const cake = list.items.find((sale) => sale.total === 5_000);
  await createTestUser({ username: 'boss', role: 'ADMIN', pin: '731940' });
  await send(cashier, 'post', `/sales/${cake?.id ?? ''}/void`, {
    reason: 'Error',
    approverPin: '731940',
  }).expect(200);
}

describe('detalle completo de caja', () => {
  it('trae costo, utilidad, anuladas, ventas y caja final', async () => {
    await seedDay();
    await voidCake();
    const response = await admin.agent.get(`/api/v1/cash-shifts/${await shiftId()}`).expect(200);
    const detail = cashShiftDetailSchema.parse(response.body);
    expect(detail.report?.performance).toMatchObject({
      salesCount: 1,
      salesTotal: 6_000,
      voidedCount: 1,
      voidedTotal: 5_000,
      costOfSales: 2_400,
      grossProfit: 3_600,
      expensesTotal: 12_000,
      openingAmount: 100_000,
      // base 100.000 + efectivo 6.000 − egreso 12.000 (sigue abierta: el esperado)
      closingCash: 94_000,
      byMethod: [{ method: 'CASH', amount: 6_000 }],
    });
    expect(detail.report?.sales).toHaveLength(2);
    expect(detail.report?.sales.find((sale) => sale.status === 'VOIDED')?.cost).toBe(0);
  });

  it('exporta la caja en CSV solo para quien tiene reportes', async () => {
    await seedDay();
    const id = await shiftId();
    await cashier.agent.get(`/api/v1/reports/cash-shifts/${id}/export`).expect(403);
    await admin.agent
      .get('/api/v1/reports/cash-shifts/000000000000000000000000/export')
      .expect(404);
    const response = await admin.agent.get(`/api/v1/reports/cash-shifts/${id}/export`).expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('Utilidad bruta');
    expect(response.text).toContain('Movimientos de caja');
    expect(response.text).toContain('Hielo');
  });
});

describe('GET /reports/performance', () => {
  it('solo para quien tiene reportes', async () => {
    await cashier.agent.get(`/api/v1/reports/performance${range()}`).expect(403);
    await admin.agent.get('/api/v1/reports/performance').expect(400);
  });

  it('una fila por caja y una por día, con autoconsumo y compras', async () => {
    await seedDay();
    await send(admin, 'post', '/inventory/self-consumption', {
      productId: breadId,
      quantity: 2,
      note: 'Desayuno del equipo',
    }).expect(201);
    const report = performanceReportSchema.parse(
      (await admin.agent.get(`/api/v1/reports/performance${range()}`).expect(200)).body,
    );
    expect(report.byShift).toHaveLength(1);
    expect(report.byShift[0]).toMatchObject({
      userName: 'Laura Gómez',
      salesTotal: 11_000,
      costOfSales: 2_400,
      grossProfit: 8_600,
      selfConsumptionValue: null,
    });
    expect(report.byDay).toHaveLength(1);
    expect(report.byDay[0]).toMatchObject({
      key: today(),
      shiftsCount: 1,
      salesTotal: 11_000,
      byMethod: [
        { method: 'CASH', amount: 6_000 },
        { method: 'NEQUI', amount: 5_000 },
      ],
      selfConsumptionValue: 1_600,
      openingAmount: 100_000,
      closingCash: 94_000,
    });
  });
});

describe('nuevos exportes', () => {
  it('desempeño, ingresos, gastos por tipo, inventario valorizado y autoconsumo', async () => {
    await seedDay();
    await send(cashier, 'post', '/cash-shifts/current/movements', {
      type: 'INCOME',
      amount: 20_000,
      reason: 'Base extra',
    }).expect(201);
    const get = (kind: string) =>
      admin.agent.get(`/api/v1/reports/export/${kind}${range()}`).expect(200);

    const performance = (await get('performance')).text.split(CRLF);
    expect(performance[0]).toContain('Utilidad bruta');
    expect(performance.some((line) => line.startsWith('Por caja;'))).toBe(true);
    expect(performance.some((line) => line.startsWith('Por día;'))).toBe(true);

    expect((await get('incomes')).text).toContain('Base extra');
    expect((await get('expenses')).text).toContain(`Sin tipo;1;12000`);
    // 7 panes a 800
    expect((await get('stock')).text).toContain(';7;800;5600');
    expect((await get('self-consumption')).text).toContain('Fecha;Hora;Producto');
  });
});

describe('filtros del listado de ventas', () => {
  it('el administrador filtra por rango, medio de pago, estado y número', async () => {
    await seedDay();
    await voidCake();
    const list = async (query: string) =>
      listSalesResponseSchema.parse(
        (await admin.agent.get(`/api/v1/sales?${query}`).expect(200)).body,
      ).items;
    expect(await list(`from=${today()}&to=${today()}`)).toHaveLength(2);
    expect(await list(`from=${today()}&to=${today()}&method=NEQUI`)).toHaveLength(1);
    expect(await list(`from=${today()}&to=${today()}&status=VOIDED`)).toHaveLength(1);
    const [first] = await list(`from=${today()}&to=${today()}&status=PAID`);
    expect(await list(`number=${String(first?.number ?? 0)}&date=2020-01-01`)).toHaveLength(1);
    await admin.agent.get('/api/v1/sales?from=2026-09-10&to=2026-09-01').expect(400);
    await admin.agent.get('/api/v1/sales?number=abc').expect(400);
  });

  it('la cajera solo ve su caja abierta aunque pida otro rango', async () => {
    await seedDay();
    const items = listSalesResponseSchema.parse(
      (
        await cashier.agent
          .get('/api/v1/sales?from=2020-01-01&to=2020-01-31&method=CASH')
          .expect(200)
      ).body,
    ).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.total).toBe(6_000);
  });
});
