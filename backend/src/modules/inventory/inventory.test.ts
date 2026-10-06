import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  inventoryItemResponseSchema,
  listInventoryResponseSchema,
  listMovementsResponseSchema,
  productResponseSchema,
  slugify,
  type AuditAction,
} from '@panesypan/shared';
import type { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../../../test/database';
import {
  createTestUser,
  DEFAULT_PASSWORD,
  DEFAULT_PIN,
  initModels,
  login,
  resetDatabase,
  type LoggedIn,
} from '../../../test/factories';
import { createTestEnv, silentLogger } from '../../../test/helpers';
import { createApp } from '../../app';
import { AuditLogModel } from '../audit/audit-log.model';
import { CategoryModel, ProductModel } from '../catalog/catalog.models';
import { SaleModel } from '../sales/sale.model';
import { InventoryItemModel, StockMovementModel } from './inventory.models';

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);
const errorOf = (body: unknown) => apiErrorResponseSchema.parse(body).error;
const itemOf = (body: unknown) => inventoryItemResponseSchema.parse(body).item;

let stopDatabase: (() => Promise<void>) | undefined;
let admin: LoggedIn;
let cashier: LoggedIn;
let otherCashier: LoggedIn;
let products: { bread: string; fritter: string; juice: string };

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
  trackStock: boolean,
): Promise<string> {
  const product = await ProductModel.create({
    name,
    slug: slugify(name),
    categoryId,
    price,
    trackStock,
  });
  return product.id;
}

beforeEach(async () => {
  await resetDatabase();
  await createTestUser({ username: 'admin', role: 'ADMIN' });
  await createTestUser({ username: 'laura', name: 'Laura Gómez', role: 'CASHIER' });
  await createTestUser({ username: 'sofia', name: 'Sofía Ríos', role: 'CASHIER' });
  admin = await login(app, 'admin', DEFAULT_PASSWORD);
  cashier = await login(app, 'laura', DEFAULT_PASSWORD);
  otherCashier = await login(app, 'sofia', DEFAULT_PASSWORD);

  const bakery = await CategoryModel.create({ name: 'Panadería', slug: 'panaderia' });
  products = {
    bread: await createProduct('Pan de bono', bakery._id, 2_000, true),
    fritter: await createProduct('Buñuelo', bakery._id, 1_500, true),
    juice: await createProduct('Jugo natural', bakery._id, 4_000, false),
  };
});

const send = (who: LoggedIn, method: 'post' | 'patch', path: string, body: object) =>
  who.agent[method](`/api/v1${path}`).set('X-CSRF-Token', who.csrfToken).send(body);

const produce = (who: LoggedIn, productId: string, quantity: number, note = '') =>
  send(who, 'post', '/inventory/production', { productId, quantity, note });

const waste = (who: LoggedIn, productId: string, quantity: number, reason = 'EXPIRED') =>
  send(who, 'post', '/inventory/waste', { productId, quantity, reason });

const stockOf = async (productId: string) =>
  (await InventoryItemModel.findOne({ productId }))?.quantity ?? 0;

const auditCount = (action: AuditAction) => AuditLogModel.countDocuments({ action });

const openShift = (who: LoggedIn) => send(who, 'post', '/cash-shifts', { openingAmount: 100_000 });

function sell(who: LoggedIn, productId: string, quantity: number, unitPrice = 2_000) {
  const total = quantity * unitPrice;
  return send(who, 'post', '/sales/checkout', {
    clientRequestId: randomUUID(),
    lines: [{ productId, quantity }],
    expectedTotal: total,
    payments: [{ method: 'CASH', amount: total }],
  });
}

describe('inventario: permisos', () => {
  it('exige sesión', async () => {
    await admin.agent.get('/api/v1/inventory').expect(200);
    expect((await request(app).get('/api/v1/inventory')).status).toBe(401);
  });

  it('la cajera ve el stock y registra producción y mermas, pero no ajusta ni fija mínimos', async () => {
    await cashier.agent.get('/api/v1/inventory').expect(200);
    expect((await produce(cashier, products.bread, 10)).status).toBe(201);
    expect((await waste(cashier, products.bread, 1)).status).toBe(201);

    const adjust = await send(cashier, 'post', '/inventory/adjustments', {
      productId: products.bread,
      newQuantity: 3,
      note: 'Conteo',
    });
    expect(adjust.status).toBe(403);
    const min = await send(cashier, 'patch', `/inventory/${products.bread}/min-stock`, {
      minStock: 5,
    });
    expect(min.status).toBe(403);
  });
});

describe('producción y mermas', () => {
  it('la producción suma al stock y queda en movimientos y auditoría', async () => {
    const first = await produce(cashier, products.bread, 40, 'Tanda de la mañana');
    expect(itemOf(first.body)).toMatchObject({ quantity: 40, producedToday: 40, wastedToday: 0 });
    await produce(cashier, products.bread, 20);
    expect(await stockOf(products.bread)).toBe(60);

    const movements = listMovementsResponseSchema.parse(
      (await cashier.agent.get('/api/v1/inventory/movements?type=PRODUCTION').expect(200)).body,
    ).items;
    expect(movements.map((movement) => movement.delta).sort()).toEqual([20, 40]);
    expect(movements.every((movement) => movement.by.name === 'Laura Gómez')).toBe(true);
    expect(await auditCount('STOCK_PRODUCTION_LOGGED')).toBe(2);
  });

  it('la merma resta, exige motivo y nunca deja el stock negativo', async () => {
    await produce(cashier, products.bread, 5);
    const ok = await waste(cashier, products.bread, 2, 'BURNED');
    expect(itemOf(ok.body)).toMatchObject({ quantity: 3, wastedToday: 2 });

    const tooMuch = await waste(cashier, products.bread, 4);
    expect(tooMuch.status).toBe(409);
    expect(errorOf(tooMuch.body).message).toContain('quedan 3');
    expect(await stockOf(products.bread)).toBe(3);

    const noReason = await send(cashier, 'post', '/inventory/waste', {
      productId: products.bread,
      quantity: 1,
    });
    expect(noReason.status).toBe(400);
    expect(await auditCount('STOCK_WASTE_LOGGED')).toBe(1);
  });

  it('rechaza cantidades inválidas y productos que no controlan inventario', async () => {
    for (const quantity of [0, -3, 1.5, 10_001]) {
      expect((await produce(cashier, products.bread, quantity)).status).toBe(400);
    }
    const untracked = await produce(cashier, products.juice, 5);
    expect(untracked.status).toBe(409);
    expect(errorOf(untracked.body).message).toContain('no controla inventario');
    expect((await produce(cashier, 'no-es-un-id', 5)).status).toBe(400);
  });

  it('dos mermas simultáneas de la última unidad: solo una se registra', async () => {
    await produce(cashier, products.bread, 1);
    const results = await Promise.all([
      waste(cashier, products.bread, 1),
      waste(otherCashier, products.bread, 1),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await stockOf(products.bread)).toBe(0);
  });
});

describe('ajustes y alertas de bajo stock', () => {
  it('el administrador ajusta con nota obligatoria y se registra la diferencia', async () => {
    await produce(cashier, products.bread, 10);
    const noNote = await send(admin, 'post', '/inventory/adjustments', {
      productId: products.bread,
      newQuantity: 7,
    });
    expect(noNote.status).toBe(400);

    const adjusted = await send(admin, 'post', '/inventory/adjustments', {
      productId: products.bread,
      newQuantity: 7,
      note: 'Conteo de cierre',
    });
    expect(itemOf(adjusted.body).quantity).toBe(7);
    const [movement] = listMovementsResponseSchema.parse(
      (await admin.agent.get('/api/v1/inventory/movements?type=ADJUSTMENT').expect(200)).body,
    ).items;
    expect(movement).toMatchObject({ delta: -3, quantityAfter: 7, note: 'Conteo de cierre' });
    expect(await auditCount('STOCK_ADJUSTED')).toBe(1);
  });

  it('avisa cuando el stock llega al mínimo y permite filtrar lo que se acaba', async () => {
    await produce(cashier, products.bread, 8);
    await produce(cashier, products.fritter, 30);
    await send(admin, 'patch', `/inventory/${products.bread}/min-stock`, { minStock: 5 }).expect(
      200,
    );
    expect(await auditCount('STOCK_MIN_UPDATED')).toBe(1);

    const before = listInventoryResponseSchema.parse(
      (await cashier.agent.get('/api/v1/inventory').expect(200)).body,
    );
    expect(before.lowStockCount).toBe(0);

    await waste(cashier, products.bread, 3);
    const after = listInventoryResponseSchema.parse(
      (await cashier.agent.get('/api/v1/inventory').expect(200)).body,
    );
    expect(after.lowStockCount).toBe(1);
    expect(after.items.find((item) => item.name === 'Pan de bono')).toMatchObject({
      quantity: 5,
      minStock: 5,
      isLow: true,
    });

    const onlyLow = listInventoryResponseSchema.parse(
      (await cashier.agent.get('/api/v1/inventory?lowStock=true').expect(200)).body,
    );
    expect(onlyLow.items.map((item) => item.name)).toEqual(['Pan de bono']);
    // Los productos sin control de inventario no aparecen.
    expect(after.items.map((item) => item.name)).not.toContain('Jugo natural');
  });

  it('un producto sin mínimo definido nunca da alerta, ni con stock en cero', async () => {
    const list = listInventoryResponseSchema.parse(
      (await cashier.agent.get('/api/v1/inventory').expect(200)).body,
    );
    expect(list.items.every((item) => !item.isLow)).toBe(true);
    expect(list.items.map((item) => item.quantity)).toEqual([0, 0]);
  });
});

describe('ventas e inventario', () => {
  beforeEach(async () => {
    await openShift(cashier);
    await openShift(otherCashier);
  });

  it('cobrar descuenta el stock y anular lo devuelve', async () => {
    await produce(cashier, products.bread, 10);
    const sale = await sell(cashier, products.bread, 3);
    expect(sale.status).toBeLessThan(300);
    expect(await stockOf(products.bread)).toBe(7);

    const saleId = (sale.body as { sale: { id: string } }).sale.id;
    const voided = await send(cashier, 'post', `/sales/${saleId}/void`, {
      reason: 'Se equivocó de pedido',
      approverPin: DEFAULT_PIN,
    });
    expect(voided.status).toBe(200);
    expect(await stockOf(products.bread)).toBe(10);

    const types = (
      await StockMovementModel.find({ productId: products.bread }).sort({ _id: 1 })
    ).map((movement) => movement.type);
    expect(types).toEqual(['PRODUCTION', 'SALE', 'SALE_VOID']);
  });

  it('no cobra más de lo que hay y deja todo intacto', async () => {
    await produce(cashier, products.bread, 2);
    const rejected = await sell(cashier, products.bread, 3);
    expect(rejected.status).toBe(409);
    expect(errorOf(rejected.body).code).toBe('OUT_OF_STOCK');
    expect(errorOf(rejected.body).message).toBe('Solo quedan 2 unidades de Pan de bono');
    expect(await stockOf(products.bread)).toBe(2);
    expect(await SaleModel.countDocuments({})).toBe(0);
  });

  it('un producto con inventario que nunca tuvo producción no se puede vender', async () => {
    const rejected = await sell(cashier, products.fritter, 1, 1_500);
    expect(rejected.status).toBe(409);
    expect(errorOf(rejected.body).message).toBe('Se acabó el inventario de Buñuelo');
  });

  it('los productos sin control de inventario se venden sin tocar el stock', async () => {
    const sale = await send(cashier, 'post', '/sales/checkout', {
      clientRequestId: randomUUID(),
      lines: [{ productId: products.juice, quantity: 1 }],
      expectedTotal: 4_000,
      payments: [{ method: 'CASH', amount: 4_000 }],
    });
    expect(sale.status).toBeLessThan(300);
    expect(await StockMovementModel.countDocuments({})).toBe(0);
  });

  it('dos cajeras vendiendo la última unidad a la vez: solo una la vende', async () => {
    await produce(cashier, products.bread, 1);
    const results = await Promise.all([
      sell(cashier, products.bread, 1),
      sell(otherCashier, products.bread, 1),
    ]);
    const statuses = results.map((result) => (result.status < 300 ? 'ok' : result.status)).sort();
    expect(statuses).toEqual([409, 'ok']);
    expect(await stockOf(products.bread)).toBe(0);
    expect(await SaleModel.countDocuments({ status: 'PAID' })).toBe(1);
  });
});

describe('costo e inventario valorizado', () => {
  it('el administrador ve el costo y el valor del inventario; la cajera no', async () => {
    await send(admin, 'patch', `/products/${products.bread}`, { cost: 900 }).expect(200);
    await produce(cashier, products.bread, 10).expect(201);
    await produce(cashier, products.fritter, 4).expect(201);

    const forAdmin = listInventoryResponseSchema.parse(
      (await admin.agent.get('/api/v1/inventory')).body,
    );
    expect(forAdmin.totalValue).toBe(9_000);
    expect(forAdmin.withoutCost).toBe(1);
    expect(forAdmin.items.find((item) => item.productId === products.bread)?.cost).toBe(900);

    const forCashier = listInventoryResponseSchema.parse(
      (await cashier.agent.get('/api/v1/inventory')).body,
    );
    expect(forCashier.totalValue).toBeNull();
    expect(forCashier.items.every((item) => item.cost === null)).toBe(true);

    const product = productResponseSchema.parse(
      (await cashier.agent.get(`/api/v1/products/${products.bread}`)).body,
    ).product;
    expect(product.cost).toBeNull();
    expect(await auditCount('PRODUCT_UPDATED')).toBe(1);
  });
});

describe('autoconsumo', () => {
  it('baja el stock, exige quién lo consumió y no cuenta como merma', async () => {
    await produce(cashier, products.bread, 10).expect(201);
    const missing = await send(cashier, 'post', '/inventory/self-consumption', {
      productId: products.bread,
      quantity: 2,
      note: '',
    });
    expect(missing.status).toBe(400);

    const response = await send(cashier, 'post', '/inventory/self-consumption', {
      productId: products.bread,
      quantity: 2,
      note: 'Desayuno del panadero',
    });
    expect(response.status).toBe(201);
    expect(itemOf(response.body)).toMatchObject({ quantity: 8, consumedToday: 2, wastedToday: 0 });
    expect(await StockMovementModel.countDocuments({ type: 'SELF_CONSUMPTION' })).toBe(1);
    expect(await auditCount('STOCK_SELF_CONSUMPTION_LOGGED')).toBe(1);
  });
});
