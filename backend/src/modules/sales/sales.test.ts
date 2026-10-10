import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  businessSettingsResponseSchema,
  cashShiftResponseSchema,
  currentCashShiftResponseSchema,
  listSalesResponseSchema,
  productResponseSchema,
  saleResponseSchema,
  slugify,
  toBusinessDate,
  type AuditAction,
} from '@panesypan/shared';
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
import { CategoryModel, DailyMenuModel, ProductModel } from '../catalog/catalog.models';
import { SaleModel } from './sale.model';

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);
const errorOf = (body: unknown) => apiErrorResponseSchema.parse(body).error;
const saleOf = (body: unknown) => saleResponseSchema.parse(body).sale;

const ADMIN_PIN = '731940';

let stopDatabase: (() => Promise<void>) | undefined;
let admin: LoggedIn;
let cashier: LoggedIn;
let otherCashier: LoggedIn;
let products: {
  bread: string;
  fritter: string;
  soldOut: string;
  lunch: string;
  broth: string;
};

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
});

afterAll(async () => {
  await stopDatabase?.();
});

async function createProduct(
  name: string,
  categoryId: Types.ObjectId,
  price: number,
  isAvailable = true,
): Promise<string> {
  const product = await ProductModel.create({
    name,
    slug: slugify(name),
    categoryId,
    price,
    isAvailable,
  });
  return product.id;
}

beforeEach(async () => {
  await resetDatabase();
  await createTestUser({ username: 'admin', role: 'ADMIN', pin: ADMIN_PIN });
  await createTestUser({ username: 'laura', name: 'Laura Gómez', role: 'CASHIER' });
  await createTestUser({ username: 'sofia', name: 'Sofía Ríos', role: 'CASHIER' });
  admin = await login(app, 'admin', DEFAULT_PASSWORD);
  cashier = await login(app, 'laura', DEFAULT_PASSWORD);
  otherCashier = await login(app, 'sofia', DEFAULT_PASSWORD);

  const bakery = await CategoryModel.create({ name: 'Panadería', slug: 'panaderia' });
  const lunches = await CategoryModel.create({
    name: 'Almuerzos',
    slug: 'almuerzos',
    kind: 'LUNCH',
  });
  products = {
    bread: await createProduct('Pan de bono', bakery._id, 2_000),
    fritter: await createProduct('Buñuelo', bakery._id, 1_500),
    soldOut: await createProduct('Almojábana', bakery._id, 2_500, false),
    lunch: await createProduct('Almuerzo corriente', lunches._id, 14_000),
    broth: await createProduct('Caldo', lunches._id, 6_000),
  };
});

const send = (
  who: LoggedIn,
  method: 'post' | 'patch' | 'put' | 'delete',
  path: string,
  body?: object,
) => who.agent[method](`/api/v1${path}`).set('X-CSRF-Token', who.csrfToken).send(body);

const openShift = (who: LoggedIn, openingAmount = 100_000) =>
  send(who, 'post', '/cash-shifts', { openingAmount });

function counterSale(
  lines: { productId: string; quantity: number; note?: string; lunch?: object | null }[],
  expectedTotal: number,
  extra: object = {},
) {
  return {
    clientRequestId: randomUUID(),
    lines,
    expectedTotal,
    payments: [{ method: 'CASH', amount: expectedTotal }],
    ...extra,
  };
}

const auditCount = (action: AuditAction) => AuditLogModel.countDocuments({ action });

describe('configuración del negocio', () => {
  it('la cajera la consulta pero solo el administrador la cambia', async () => {
    const read = await cashier.agent.get('/api/v1/settings').expect(200);
    expect(businessSettingsResponseSchema.parse(read.body).settings).toMatchObject({
      tableCount: 8,
      maxCashierDiscountPercent: 10,
      ticketWidth: '80',
      updatedAt: null,
    });

    const denied = await send(cashier, 'patch', '/settings', { tableCount: 10 });
    expect(denied.status).toBe(403);

    const saved = await send(admin, 'patch', '/settings', {
      legalName: 'Panes y Pan S.A.S.',
      taxId: '900.123.456-7',
      ticketWidth: '58',
    });
    expect(saved.status).toBe(200);
    expect(businessSettingsResponseSchema.parse(saved.body).settings).toMatchObject({
      legalName: 'Panes y Pan S.A.S.',
      ticketWidth: '58',
      tableCount: 8,
    });
    expect(await auditCount('SETTINGS_UPDATED')).toBe(1);
  });

  it('no deja quitar una mesa que tiene la cuenta abierta', async () => {
    await send(cashier, 'post', '/tabs', { tableNumber: 7 }).expect(201);
    const response = await send(admin, 'patch', '/settings', { tableCount: 6 });
    expect(response.status).toBe(409);
    expect(errorOf(response.body).message).toContain('mesa 7');
  });
});

describe('apertura de caja', () => {
  it('abre la caja una sola vez y exige tenerla abierta para cobrar', async () => {
    const withoutShift = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.bread, quantity: 1 }], 2_000),
    );
    expect(withoutShift.status).toBe(409);
    expect(errorOf(withoutShift.body).code).toBe('CASH_SHIFT_REQUIRED');

    const current = await cashier.agent.get('/api/v1/cash-shifts/current').expect(200);
    expect(currentCashShiftResponseSchema.parse(current.body).shift).toBeNull();

    const opened = await openShift(cashier, 80_000);
    expect(opened.status).toBe(201);
    const shift = cashShiftResponseSchema.parse(opened.body).shift;
    expect(shift).toMatchObject({ status: 'OPEN', openingAmount: 80_000, userName: 'Laura Gómez' });
    expect(shift.summary.expectedCash).toBe(80_000);

    const again = await openShift(cashier);
    expect(again.status).toBe(409);
    expect(await auditCount('CASH_SHIFT_OPENED')).toBe(1);
  });

  it('valida la base inicial', async () => {
    expect((await openShift(cashier, -1)).status).toBe(400);
    expect((await send(cashier, 'post', '/cash-shifts', { openingAmount: 1000.5 })).status).toBe(
      400,
    );
  });
});

describe('venta de mostrador', () => {
  beforeEach(async () => {
    await openShift(cashier).expect(201);
  });

  it('cobra con el precio de la base de datos y calcula el cambio', async () => {
    const response = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale(
        [
          { productId: products.bread, quantity: 3 },
          { productId: products.fritter, quantity: 2 },
        ],
        9_000,
        { cashReceived: 20_000 },
      ),
    );
    expect(response.status).toBe(201);
    const sale = saleOf(response.body);
    expect(sale).toMatchObject({
      number: 1,
      type: 'COUNTER',
      status: 'PAID',
      subtotal: 9_000,
      total: 9_000,
      cashReceived: 20_000,
      change: 11_000,
      businessDate: toBusinessDate(),
    });
    expect(sale.lines.map((line) => [line.name, line.total])).toEqual([
      ['Pan de bono', 6_000],
      ['Buñuelo', 3_000],
    ]);

    const second = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.bread, quantity: 1 }], 2_000),
    );
    expect(saleOf(second.body).number).toBe(2);

    const current = await cashier.agent.get('/api/v1/cash-shifts/current').expect(200);
    expect(currentCashShiftResponseSchema.parse(current.body).shift?.summary).toMatchObject({
      salesCount: 2,
      salesTotal: 11_000,
      expectedCash: 111_000,
      byMethod: [{ method: 'CASH', amount: 11_000, count: 2 }],
    });
  });

  it('un reintento con el mismo identificador no cobra dos veces', async () => {
    const body = counterSale([{ productId: products.bread, quantity: 1 }], 2_000);
    const first = await send(cashier, 'post', '/sales/checkout', body);
    const retry = await send(cashier, 'post', '/sales/checkout', body);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(saleOf(retry.body).id).toBe(saleOf(first.body).id);
    expect(await SaleModel.countDocuments()).toBe(1);
  });

  it('avisa si el total cambió mientras se cobraba', async () => {
    await ProductModel.updateOne({ _id: products.bread }, { $set: { price: 2_200 } });
    const response = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.bread, quantity: 1 }], 2_000),
    );
    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('TOTAL_MISMATCH');
    expect(await SaleModel.countDocuments()).toBe(0);
  });

  it('no vende productos agotados', async () => {
    const response = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.soldOut, quantity: 1 }], 2_500),
    );
    expect(response.status).toBe(409);
    expect(errorOf(response.body)).toMatchObject({
      code: 'OUT_OF_STOCK',
      message: 'Almojábana está agotado',
    });
  });

  it('acepta pagos combinados y rechaza los que no cuadran', async () => {
    const mixed = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale(
        [
          { productId: products.lunch, quantity: 1 },
          { productId: products.bread, quantity: 1 },
        ],
        16_000,
        {
          payments: [
            { method: 'NEQUI', amount: 10_000, reference: 'M123' },
            { method: 'CASH', amount: 6_000 },
          ],
          cashReceived: 10_000,
        },
      ),
    );
    // El almuerzo no está en el menú de hoy: no se vende.
    expect(errorOf(mixed.body).code).toBe('OUT_OF_STOCK');

    const ok = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.bread, quantity: 5 }], 10_000, {
        payments: [
          { method: 'NEQUI', amount: 4_000, reference: 'M123' },
          { method: 'CASH', amount: 6_000 },
        ],
        cashReceived: 10_000,
      }),
    );
    expect(ok.status).toBe(201);
    expect(saleOf(ok.body)).toMatchObject({ change: 4_000, cashReceived: 10_000 });

    const short = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.bread, quantity: 1 }], 2_000, {
        payments: [{ method: 'CASH', amount: 1_000 }],
      }),
    );
    expect(short.status).toBe(400);
  });

  it('rechaza precios enviados por la tablet', async () => {
    const response = await send(cashier, 'post', '/sales/checkout', {
      ...counterSale([{ productId: products.bread, quantity: 1 }], 2_000),
      lines: [{ productId: products.bread, quantity: 1, unitPrice: 1 }],
    });
    expect(response.status).toBe(400);
  });
});

describe('precios por cantidad', () => {
  const tiers = [
    { minQuantity: 12, unitPrice: 1_700 },
    { minQuantity: 24, unitPrice: 1_600 },
  ];

  beforeEach(async () => {
    await openShift(cashier).expect(201);
    await ProductModel.updateOne({ _id: products.bread }, { $set: { priceTiers: tiers } });
  });

  it('el cobro de mostrador usa el precio de la escala que alcanza la cantidad', async () => {
    const response = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale(
        [
          { productId: products.bread, quantity: 12 },
          { productId: products.bread, quantity: 3, note: 'Sin azúcar' },
        ],
        12 * 1_700 + 3 * 2_000,
      ),
    );
    expect(response.status).toBe(201);
    const sale = saleOf(response.body);
    expect(sale.lines.map((line) => [line.quantity, line.unitPrice, line.listPrice])).toEqual([
      [12, 1_700, 2_000],
      [3, 2_000, 2_000],
    ]);
    expect(sale.total).toBe(26_400);
  });

  it('en la mesa, el precio se recalcula al cambiar la cantidad', async () => {
    const tab = saleOf((await send(cashier, 'post', '/tabs', { tableNumber: 2 })).body);
    await send(cashier, 'post', `/tabs/${tab.id}/lines`, {
      productId: products.bread,
      quantity: 10,
    }).expect(200);
    // Se suma a la misma línea y llega a la escala de 12.
    const added = saleOf(
      (
        await send(cashier, 'post', `/tabs/${tab.id}/lines`, {
          productId: products.bread,
          quantity: 2,
        }).expect(200)
      ).body,
    );
    expect(added.lines).toHaveLength(1);
    expect(added.lines[0]).toMatchObject({ quantity: 12, unitPrice: 1_700, total: 20_400 });

    const lineId = added.lines[0]?.id ?? '';
    const more = saleOf(
      (
        await send(cashier, 'patch', `/tabs/${tab.id}/lines/${lineId}`, { quantity: 30 }).expect(
          200,
        )
      ).body,
    );
    expect(more.lines[0]).toMatchObject({ unitPrice: 1_600, total: 48_000 });
    expect(more.total).toBe(48_000);

    const fewer = saleOf(
      (await send(cashier, 'patch', `/tabs/${tab.id}/lines/${lineId}`, { quantity: 5 }).expect(200))
        .body,
    );
    expect(fewer.lines[0]).toMatchObject({ unitPrice: 2_000, total: 10_000 });
    expect(fewer.total).toBe(10_000);
  });

  it('el administrador guarda las escalas y no acepta escalas en almuerzos ni más caras', async () => {
    const saved = await send(admin, 'patch', `/products/${products.fritter}`, {
      priceTiers: [{ minQuantity: 6, unitPrice: 1_300 }],
    });
    expect(saved.status).toBe(200);
    expect(productResponseSchema.parse(saved.body).product.priceTiers).toEqual([
      { minQuantity: 6, unitPrice: 1_300 },
    ]);
    const audit = await AuditLogModel.findOne({ action: 'PRODUCT_UPDATED' }).lean();
    expect(audit?.metadata).toMatchObject({
      changes: { priceTiers: { from: 'sin precios por cantidad', to: '6:1300' } },
    });

    const expensive = await send(admin, 'patch', `/products/${products.fritter}`, {
      priceTiers: [{ minQuantity: 6, unitPrice: 1_500 }],
    });
    expect(expensive.status).toBe(400);
    const lunch = await send(admin, 'patch', `/products/${products.lunch}`, {
      priceTiers: [{ minQuantity: 6, unitPrice: 10_000 }],
    });
    expect(lunch.status).toBe(400);
  });
});

describe('descuentos', () => {
  beforeEach(async () => {
    await openShift(cashier).expect(201);
  });

  const discounted = (percent: number, extra: object = {}) =>
    counterSale([{ productId: products.bread, quantity: 5 }], 10_000 - percent * 100, {
      discount: { mode: 'PERCENT', value: percent, reason: 'Cliente frecuente' },
      ...extra,
    });

  it('la cajera da descuentos hasta el tope sin autorización', async () => {
    const response = await send(cashier, 'post', '/sales/checkout', discounted(10));
    expect(response.status).toBe(201);
    expect(saleOf(response.body).discount).toMatchObject({ amount: 1_000, approvedBy: null });
  });

  it('por encima del tope pide el PIN de un administrador', async () => {
    const withoutPin = await send(cashier, 'post', '/sales/checkout', discounted(20));
    expect(withoutPin.status).toBe(403);
    expect(errorOf(withoutPin.body).code).toBe('APPROVAL_REQUIRED');

    const wrongPin = await send(
      cashier,
      'post',
      '/sales/checkout',
      discounted(20, { approverPin: '111222' }),
    );
    expect(wrongPin.status).toBe(403);
    expect(errorOf(wrongPin.body)).toMatchObject({
      code: 'INVALID_PIN',
      details: { remainingAttempts: 4 },
    });
    expect(await auditCount('APPROVAL_FAILED')).toBe(1);

    const approved = await send(
      cashier,
      'post',
      '/sales/checkout',
      discounted(20, { approverPin: ADMIN_PIN }),
    );
    expect(approved.status).toBe(201);
    expect(saleOf(approved.body).discount?.approvedBy?.name).toBe(admin.body.user.name);
    expect(await auditCount('SALE_DISCOUNT_APPROVED')).toBe(1);
  });

  it('cinco PIN equivocados cierran la sesión de la cajera', async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await send(
        cashier,
        'post',
        '/sales/checkout',
        discounted(20, { approverPin: '000111' }),
      );
      expect(response.status).toBe(403);
    }
    const last = await send(
      cashier,
      'post',
      '/sales/checkout',
      discounted(20, { approverPin: '000111' }),
    );
    expect(last.status).toBe(401);
    await cashier.agent.get('/api/v1/cash-shifts/current').expect(401);
    expect(await auditCount('AUTH_SESSION_REVOKED_PIN')).toBe(1);
  });

  it('no deja la venta en cero', async () => {
    const response = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.bread, quantity: 1 }], 0, {
        discount: { mode: 'AMOUNT', value: 2_000, reason: 'Cortesía' },
        payments: [{ method: 'CASH', amount: 1 }],
        approverPin: ADMIN_PIN,
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe('almuerzos con porciones', () => {
  beforeEach(async () => {
    await openShift(cashier).expect(201);
    await DailyMenuModel.create({
      date: toBusinessDate(),
      isPublished: true,
      soups: [{ name: 'Sancocho' }],
      principles: [{ name: 'Fríjoles' }, { name: 'Lentejas', isAvailable: false }],
      proteins: [{ name: 'Pollo asado' }, { name: 'Cerdo' }],
      drinks: [{ name: 'Limonada' }, { name: 'Gaseosa', isAvailable: false }],
      offerings: [
        { productId: products.lunch, portions: 2, sold: 0 },
        { productId: products.broth, portions: null, sold: 0, withChoices: false },
      ],
    });
  });

  const choice = {
    protein: 'Pollo asado',
    principle: 'Fríjoles',
    soup: 'Sancocho',
    drink: 'Limonada',
  };

  const soldPortions = async () =>
    (await DailyMenuModel.findOne({ date: toBusinessDate() }))?.offerings[0]?.sold;

  it('descuenta porciones, no vende de más y las devuelve al anular', async () => {
    const first = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.lunch, quantity: 2, lunch: choice }], 28_000),
    );
    expect(first.status).toBe(201);
    expect(saleOf(first.body).lines[0]).toMatchObject({
      isLunch: true,
      note: 'Pollo asado · Fríjoles · Sancocho · Limonada',
      lunch: choice,
    });
    expect(await soldPortions()).toBe(2);

    const extra = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.lunch, quantity: 1, lunch: choice }], 14_000),
    );
    expect(extra.status).toBe(409);
    expect(errorOf(extra.body).message).toBe('Se acabaron las porciones de Almuerzo corriente');

    const voided = await send(cashier, 'post', `/sales/${saleOf(first.body).id}/void`, {
      reason: 'Se equivocó de pedido',
      approverPin: ADMIN_PIN,
    });
    expect(voided.status).toBe(200);
    expect(await soldPortions()).toBe(0);
  });

  it('dos cajeras vendiendo la última porción a la vez: solo una la vende', async () => {
    await openShift(otherCashier).expect(201);
    await DailyMenuModel.updateOne(
      { date: toBusinessDate() },
      { $set: { 'offerings.0.portions': 1 } },
    );
    const results = await Promise.all(
      [cashier, otherCashier].map((who) =>
        send(
          who,
          'post',
          '/sales/checkout',
          counterSale([{ productId: products.lunch, quantity: 1, lunch: choice }], 14_000),
        ),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await soldPortions()).toBe(1);
    expect(await SaleModel.countDocuments({ status: 'PAID' })).toBe(1);
  });

  it('no vende almuerzos si el menú no está publicado', async () => {
    await DailyMenuModel.updateOne({ date: toBusinessDate() }, { $set: { isPublished: false } });
    const response = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.lunch, quantity: 1, lunch: choice }], 14_000),
    );
    expect(errorOf(response.body).message).toBe('Almuerzo corriente no está en el menú de hoy');
  });

  it('el almuerzo exige proteína y principio del menú; la sopa es opcional', async () => {
    const sell = (lunch: object | null) =>
      send(
        cashier,
        'post',
        '/sales/checkout',
        counterSale([{ productId: products.lunch, quantity: 1, lunch }], 14_000),
      );

    const withoutChoice = await sell(null);
    expect(withoutChoice.status).toBe(400);
    expect(errorOf(withoutChoice.body).message).toMatch(/Elige la proteína/);

    const soldOut = await sell({ ...choice, principle: 'Lentejas' });
    expect(soldOut.status).toBe(409);
    expect(errorOf(soldOut.body).message).toBe('Se acabó Lentejas');

    const unknown = await sell({ ...choice, protein: 'Pescado' });
    expect(unknown.status).toBe(400);
    expect(errorOf(unknown.body).message).toMatch(/Pescado no es una proteína/);

    const drinkSoldOut = await sell({ ...choice, drink: 'Gaseosa' });
    expect(drinkSoldOut.status).toBe(409);
    expect(errorOf(drinkSoldOut.body).message).toBe('Se acabó Gaseosa');

    const unknownDrink = await sell({ ...choice, drink: 'Té' });
    expect(unknownDrink.status).toBe(400);
    expect(errorOf(unknownDrink.body).message).toMatch(/Té no es una bebida/);

    const noSoup = await sell({ ...choice, soup: null, drink: null });
    expect(noSoup.status).toBe(201);
    expect(saleOf(noSoup.body).lines[0]?.note).toBe(
      'Pollo asado · Fríjoles · Sin sopa · Sin bebida',
    );
  });

  it('el caldo solo se vende con su precio y sin elegir nada', async () => {
    const broth = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.broth, quantity: 2 }], 12_000),
    );
    expect(broth.status).toBe(201);
    expect(saleOf(broth.body).lines[0]).toMatchObject({
      name: 'Caldo',
      total: 12_000,
      lunch: null,
    });

    const withChoice = await send(
      cashier,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.broth, quantity: 1, lunch: choice }], 6_000),
    );
    expect(withChoice.status).toBe(400);
  });

  it('en la mesa, el mismo almuerzo con otra proteína es otra línea', async () => {
    const tab = saleOf((await send(cashier, 'post', '/tabs', { tableNumber: 1 })).body);
    const add = (lunch: object) =>
      send(cashier, 'post', `/tabs/${tab.id}/lines`, {
        productId: products.lunch,
        quantity: 1,
        lunch,
      });
    await add(choice).expect(200);
    const last = await add({ ...choice, protein: 'Cerdo' });
    expect(last.status).toBe(200);
    expect(saleOf(last.body).lines.map((line) => line.note)).toEqual([
      'Pollo asado · Fríjoles · Sancocho · Limonada',
      'Cerdo · Fríjoles · Sancocho · Limonada',
    ]);
  });
});

describe('mesas', () => {
  beforeEach(async () => {
    await openShift(cashier).expect(201);
  });

  async function openTable(tableNumber: number, who: LoggedIn = cashier) {
    const response = await send(who, 'post', '/tabs', { tableNumber });
    expect(response.status).toBe(201);
    return saleOf(response.body);
  }

  it('abre la cuenta, agrega, modifica, cambia de mesa y cobra', async () => {
    const tab = await openTable(3);
    expect(tab).toMatchObject({ status: 'OPEN', tableNumber: 3, total: 0, number: null });

    const taken = await send(otherCashier, 'post', '/tabs', { tableNumber: 3 });
    expect(taken.status).toBe(409);

    await send(cashier, 'post', `/tabs/${tab.id}/lines`, {
      productId: products.bread,
      quantity: 2,
    }).expect(200);
    // Otra cajera agrega a la misma mesa: se suma a la línea existente.
    const merged = saleOf(
      (
        await send(otherCashier, 'post', `/tabs/${tab.id}/lines`, {
          productId: products.bread,
          quantity: 1,
        }).expect(200)
      ).body,
    );
    expect(merged.lines).toHaveLength(1);
    expect(merged.lines[0]?.quantity).toBe(3);

    const withFritter = saleOf(
      (
        await send(cashier, 'post', `/tabs/${tab.id}/lines`, {
          productId: products.fritter,
          quantity: 2,
        }).expect(200)
      ).body,
    );
    expect(withFritter.total).toBe(9_000);

    const fritterLine = withFritter.lines.find((line) => line.name === 'Buñuelo');
    const lowered = saleOf(
      (
        await send(cashier, 'patch', `/tabs/${tab.id}/lines/${fritterLine?.id ?? ''}`, {
          quantity: 1,
        }).expect(200)
      ).body,
    );
    expect(lowered.total).toBe(7_500);
    expect(await auditCount('TAB_ITEM_REMOVED')).toBe(1);

    const moved = saleOf(
      (await send(cashier, 'patch', `/tabs/${tab.id}`, { tableNumber: 5 }).expect(200)).body,
    );
    expect(moved.tableNumber).toBe(5);

    const open = await cashier.agent.get('/api/v1/tabs').expect(200);
    expect(listSalesResponseSchema.parse(open.body).items.map((item) => item.tableNumber)).toEqual([
      5,
    ]);

    // Si el total que vio la cajera ya no es el de la cuenta, se avisa.
    const stale = await send(cashier, 'post', `/tabs/${tab.id}/checkout`, {
      clientRequestId: randomUUID(),
      expectedTotal: 9_000,
      payments: [{ method: 'CASH', amount: 9_000 }],
    });
    expect(errorOf(stale.body).code).toBe('TOTAL_MISMATCH');

    const paidBody = {
      clientRequestId: randomUUID(),
      expectedTotal: 7_500,
      payments: [{ method: 'DAVIPLATA', amount: 7_500 }],
    };
    const paid = saleOf(
      (await send(cashier, 'post', `/tabs/${tab.id}/checkout`, paidBody).expect(200)).body,
    );
    expect(paid).toMatchObject({ status: 'PAID', number: 1, total: 7_500, tableNumber: 5 });
    // El reintento devuelve la misma venta.
    const retry = saleOf(
      (await send(cashier, 'post', `/tabs/${tab.id}/checkout`, paidBody).expect(200)).body,
    );
    expect(retry.number).toBe(1);

    // La mesa queda libre.
    await openTable(5);
  });

  it('quitar un producto queda en la auditoría', async () => {
    const tab = await openTable(1);
    const withBread = saleOf(
      (
        await send(cashier, 'post', `/tabs/${tab.id}/lines`, {
          productId: products.bread,
          quantity: 1,
        }).expect(200)
      ).body,
    );
    const removed = saleOf(
      (
        await send(
          cashier,
          'delete',
          `/tabs/${tab.id}/lines/${withBread.lines[0]?.id ?? ''}`,
        ).expect(200)
      ).body,
    );
    expect(removed.lines).toHaveLength(0);
    const log = await AuditLogModel.findOne({ action: 'TAB_ITEM_REMOVED' });
    expect(log?.metadata).toMatchObject({ table: 1, product: 'Pan de bono', quantity: 1 });
  });

  it('no abre mesas que no existen', async () => {
    const response = await send(cashier, 'post', '/tabs', { tableNumber: 9 });
    expect(response.status).toBe(400);
  });

  it('cancelar una cuenta con productos exige autorización; vacía no', async () => {
    const empty = await openTable(2);
    await send(cashier, 'post', `/tabs/${empty.id}/cancel`, { reason: 'Se fueron' }).expect(200);

    const tab = await openTable(4);
    await send(cashier, 'post', `/tabs/${tab.id}/lines`, {
      productId: products.bread,
      quantity: 1,
    }).expect(200);
    const denied = await send(cashier, 'post', `/tabs/${tab.id}/cancel`, { reason: 'Se fueron' });
    expect(errorOf(denied.body).code).toBe('APPROVAL_REQUIRED');

    const canceled = saleOf(
      (
        await send(cashier, 'post', `/tabs/${tab.id}/cancel`, {
          reason: 'Se fueron sin pedir',
          approverPin: ADMIN_PIN,
        }).expect(200)
      ).body,
    );
    expect(canceled.status).toBe('CANCELED');
    expect(canceled.closure?.approvedBy?.name).toBe(admin.body.user.name);
    expect(await auditCount('TAB_CANCELED')).toBe(2);

    const again = await send(cashier, 'post', `/tabs/${tab.id}/lines`, {
      productId: products.bread,
      quantity: 1,
    });
    expect(again.status).toBe(409);
  });
});

describe('anulación y consulta de ventas', () => {
  beforeEach(async () => {
    await openShift(cashier).expect(201);
    await openShift(otherCashier).expect(201);
  });

  async function sell(who: LoggedIn) {
    const response = await send(
      who,
      'post',
      '/sales/checkout',
      counterSale([{ productId: products.bread, quantity: 1 }], 2_000),
    );
    expect(response.status).toBe(201);
    return saleOf(response.body);
  }

  it('cualquier cajera anula sin PIN y queda en la auditoría con los productos', async () => {
    const sale = await sell(otherCashier);
    const voided = saleOf(
      (
        await send(cashier, 'post', `/sales/${sale.id}/void`, {
          reason: 'Error de cobro',
        }).expect(200)
      ).body,
    );
    expect(voided).toMatchObject({ status: 'VOIDED', closure: { reason: 'Error de cobro' } });

    const twice = await send(cashier, 'post', `/sales/${sale.id}/void`, { reason: 'Otra vez' });
    expect(twice.status).toBe(409);

    const current = await otherCashier.agent.get('/api/v1/cash-shifts/current').expect(200);
    expect(currentCashShiftResponseSchema.parse(current.body).shift?.summary).toMatchObject({
      salesCount: 0,
      voidedCount: 1,
      expectedCash: 100_000,
    });
    const entry = await AuditLogModel.findOne({ action: 'SALE_VOIDED' }).lean();
    expect(entry?.actor).toMatchObject({ name: 'Laura Gómez' });
    expect(JSON.stringify(entry?.metadata)).toContain('Error de cobro');
    expect((entry?.metadata as { lines?: unknown[] } | undefined)?.lines).toHaveLength(1);
  });

  it('el administrador anula sin PIN y ve las ventas del día; la cajera solo las suyas', async () => {
    const mine = await sell(cashier);
    await sell(otherCashier);

    await send(admin, 'post', `/sales/${mine.id}/void`, { reason: 'Revisión' }).expect(200);

    const own = await cashier.agent.get('/api/v1/sales').expect(200);
    expect(listSalesResponseSchema.parse(own.body).items.map((item) => item.id)).toEqual([mine.id]);

    const all = await admin.agent.get(`/api/v1/sales?date=${toBusinessDate()}`).expect(200);
    expect(listSalesResponseSchema.parse(all.body).items).toHaveLength(2);
  });

  it('la cajera consulta ventas de su caja y cuentas abiertas, no las de otra caja', async () => {
    const mine = await sell(cashier);
    const theirs = await sell(otherCashier);
    const tab = saleOf((await send(otherCashier, 'post', '/tabs', { tableNumber: 3 })).body);

    await cashier.agent.get(`/api/v1/sales/${mine.id}`).expect(200);
    await cashier.agent.get(`/api/v1/sales/${tab.id}`).expect(200);
    const denied = await cashier.agent.get(`/api/v1/sales/${theirs.id}`);
    expect(denied.status).toBe(404);
    await admin.agent.get(`/api/v1/sales/${theirs.id}`).expect(200);
  });

  it('un identificador de cobro ya usado no cobra la cuenta de una mesa', async () => {
    const counter = await sell(cashier);
    const stored = await SaleModel.findById(counter.id).orFail();
    const tab = saleOf((await send(cashier, 'post', '/tabs', { tableNumber: 2 })).body);
    await send(cashier, 'post', `/tabs/${tab.id}/lines`, {
      productId: products.bread,
      quantity: 1,
    }).expect(200);

    const response = await send(cashier, 'post', `/tabs/${tab.id}/checkout`, {
      clientRequestId: stored.clientRequestId,
      expectedTotal: 2_000,
      discount: null,
      payments: [{ method: 'CASH', amount: 2_000 }],
    });
    expect(response.status).toBe(409);
    expect((await SaleModel.findById(tab.id).orFail()).status).toBe('OPEN');
  });

  it('exige sesión y token CSRF', async () => {
    const anonymous = await request(app).get('/api/v1/tabs');
    expect(anonymous.status).toBe(401);
    const withoutCsrf = await cashier.agent
      .post('/api/v1/sales/checkout')
      .send(counterSale([{ productId: products.bread, quantity: 1 }], 2_000));
    expect(withoutCsrf.status).toBe(403);
  });
});
