import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  businessReportSchema,
  currentCashShiftResponseSchema,
  listCashMovementsResponseSchema,
  listPurchasesResponseSchema,
  listSalesResponseSchema,
  listSupplierReturnsResponseSchema,
  orderSuggestionsResponseSchema,
  purchaseResponseSchema,
  slugify,
  supplierResponseSchema,
  supplierReturnResponseSchema,
  toBusinessDate,
} from '@panesypan/shared';
import { Types } from 'mongoose';
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
import { CashMovementModel } from '../cash/cash-movement.model';
import { CategoryModel, ProductModel } from '../catalog/catalog.models';
import { InventoryItemModel, StockMovementModel } from '../inventory/inventory.models';
import { SaleModel } from '../sales/sale.model';
import { PurchaseModel } from './purchases.models';

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);
const errorOf = (body: unknown) => apiErrorResponseSchema.parse(body).error;
const ADMIN_PIN = '731940';

let stopDatabase: (() => Promise<void>) | undefined;
let admin: LoggedIn;
let cashier: LoggedIn;
let colaId: string;
let breadId: string;
let supplierId: string;

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
});

afterAll(async () => {
  await stopDatabase?.();
});

const send = (who: LoggedIn, method: 'post' | 'patch', path: string, body?: object) =>
  who.agent[method](`/api/v1${path}`).set('X-CSRF-Token', who.csrfToken).send(body);

beforeEach(async () => {
  await resetDatabase();
  await createTestUser({ username: 'admin', role: 'ADMIN', pin: ADMIN_PIN });
  await createTestUser({ username: 'laura', name: 'Laura Gómez', role: 'CASHIER' });
  admin = await login(app, 'admin', DEFAULT_PASSWORD);
  cashier = await login(app, 'laura', DEFAULT_PASSWORD);
  const drinks = await CategoryModel.create({ name: 'Bebidas', slug: 'bebidas' });
  const cola = await ProductModel.create({
    name: 'Big Cola',
    slug: slugify('Big Cola'),
    categoryId: drinks._id,
    price: 3_000,
    trackStock: true,
  });
  const bread = await ProductModel.create({
    name: 'Pan de bono',
    slug: slugify('Pan de bono'),
    categoryId: drinks._id,
    price: 2_000,
    trackStock: true,
  });
  colaId = cola.id;
  breadId = bread.id;
  supplierId = supplierResponseSchema.parse(
    (await send(admin, 'post', '/suppliers', { name: 'Surtiquesos', phone: '3001234567' })).body,
  ).supplier.id;
});

const purchase = (who: LoggedIn, body: object) => send(who, 'post', '/purchases', body);

describe('proveedores', () => {
  it('solo el administrador los crea y no deja repetir el nombre', async () => {
    await send(cashier, 'post', '/suppliers', { name: 'Postobón' }).expect(403);
    const again = await send(admin, 'post', '/suppliers', { name: 'surtiquesos' });
    expect(again.status).toBe(409);
    await cashier.agent.get('/api/v1/suppliers').expect(200);
  });
});

describe('compras', () => {
  it('por transferencia: sube el stock, deja el último costo y no toca la caja', async () => {
    const response = await purchase(admin, {
      supplierId,
      paymentMethod: 'TRANSFER',
      reference: 'TRF-889',
      lines: [
        { productId: colaId, quantity: 24, unitCost: 1_791 },
        { description: 'Queso costeño 5 kg', quantity: 1, unitCost: 95_000 },
      ],
    });
    expect(response.status).toBe(201);
    const created = purchaseResponseSchema.parse(response.body).purchase;
    expect(created).toMatchObject({ number: 1, total: 24 * 1_791 + 95_000 });
    expect((await InventoryItemModel.findOne({ productId: colaId }))?.quantity).toBe(24);
    expect((await ProductModel.findById(colaId))?.cost).toBe(1_791);
    expect(await StockMovementModel.countDocuments({ type: 'PURCHASE' })).toBe(1);

    const today = toBusinessDate();
    const list = listPurchasesResponseSchema.parse(
      (await admin.agent.get(`/api/v1/purchases?from=${today}&to=${today}`)).body,
    );
    expect(list.total).toBe(created.total);
  });

  it('con efectivo de la caja: exige la caja abierta y registra el egreso solo', async () => {
    const body = {
      supplierId,
      paymentMethod: 'CASH_DRAWER',
      lines: [{ productId: colaId, quantity: 10, unitCost: 1_800 }],
    };
    const closed = await purchase(cashier, body);
    expect(closed.status).toBe(409);
    expect(errorOf(closed.body).code).toBe('CASH_SHIFT_REQUIRED');

    await send(cashier, 'post', '/cash-shifts', { openingAmount: 100_000 }).expect(201);
    await purchase(cashier, body).expect(201);

    const movements = listCashMovementsResponseSchema.parse(
      (await cashier.agent.get('/api/v1/cash-shifts/current/movements')).body,
    ).items;
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      type: 'EXPENSE',
      amount: 18_000,
      conceptName: 'Proveedor',
      supplier: 'Surtiquesos',
      reason: 'Compra N.º 1',
    });
    const shift = currentCashShiftResponseSchema.parse(
      (await cashier.agent.get('/api/v1/cash-shifts/current')).body,
    ).shift;
    expect(shift?.summary.expectedCash).toBe(82_000);
  });

  it('sobre el tope de la cajera pide el PIN y nunca saca más de lo que hay', async () => {
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 300_000 }).expect(201);
    const big = {
      supplierId,
      paymentMethod: 'CASH_DRAWER',
      lines: [{ productId: colaId, quantity: 100, unitCost: 2_000 }],
    };
    const noPin = await purchase(cashier, big);
    expect(noPin.status).toBe(403);
    expect(errorOf(noPin.body).code).toBe('APPROVAL_REQUIRED');
    await purchase(cashier, { ...big, approverPin: ADMIN_PIN }).expect(201);

    const tooMuch = await purchase(cashier, {
      ...big,
      approverPin: ADMIN_PIN,
      lines: [{ productId: colaId, quantity: 100, unitCost: 1_500 }],
    });
    expect(tooMuch.status).toBe(409);
  });

  it('pedido sugerido: agrupa por proveedor lo que está en el mínimo', async () => {
    await send(admin, 'patch', `/products/${colaId}`, { supplierId }).expect(200);
    await InventoryItemModel.create({ productId: colaId, quantity: 2, minStock: 6 });
    await InventoryItemModel.create({ productId: breadId, quantity: 0, minStock: 10 });

    await cashier.agent.get('/api/v1/purchases/order-suggestions').expect(403);
    const { groups } = orderSuggestionsResponseSchema.parse(
      (await admin.agent.get('/api/v1/purchases/order-suggestions')).body,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      supplier: { name: 'Surtiquesos' },
      items: [{ name: 'Big Cola', quantity: 2, minStock: 6, suggested: 10 }],
    });
    expect(groups[1]?.supplier).toBeNull();
  });
});

describe('reporte del negocio', () => {
  it('calcula la utilidad estimada sin contar dos veces las compras', async () => {
    await purchase(admin, {
      supplierId,
      paymentMethod: 'TRANSFER',
      lines: [
        { productId: colaId, quantity: 24, unitCost: 1_000 },
        { description: 'Bolsas', quantity: 1, unitCost: 5_000 },
      ],
    }).expect(201);
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 100_000 }).expect(201);
    await send(cashier, 'post', '/sales/checkout', {
      clientRequestId: randomUUID(),
      lines: [{ productId: colaId, quantity: 2 }],
      expectedTotal: 6_000,
      payments: [{ method: 'CASH', amount: 6_000 }],
    }).expect(201);
    await send(cashier, 'post', '/cash-shifts/current/movements', {
      type: 'EXPENSE',
      amount: 2_000,
      reason: 'Hielo',
    }).expect(201);
    // Compra pagada con la caja: su egreso no se cuenta otra vez como gasto.
    await purchase(cashier, {
      supplierId,
      paymentMethod: 'CASH_DRAWER',
      lines: [{ productId: colaId, quantity: 5, unitCost: 1_000 }],
    }).expect(201);

    const today = toBusinessDate();
    await cashier.agent.get(`/api/v1/reports/business?from=${today}&to=${today}`).expect(403);
    const report = businessReportSchema.parse(
      (await admin.agent.get(`/api/v1/reports/business?from=${today}&to=${today}`)).body,
    );
    expect(report).toMatchObject({
      netSales: 6_000,
      costOfSales: 2_000,
      expensesTotal: 2_000,
      suppliesTotal: 5_000,
      estimatedProfit: 6_000 - 2_000 - 2_000 - 5_000,
      stockValue: 27 * 1_000,
    });
    expect(report.purchasesBySupplier).toEqual([{ name: 'Surtiquesos', amount: 34_000, count: 2 }]);
    expect(report.byProduct[0]).toMatchObject({ name: 'Big Cola', quantity: 2, total: 6_000 });
  });

  it('la utilidad usa el costo del momento de la venta, aunque el costo cambie después', async () => {
    await purchase(admin, {
      supplierId,
      paymentMethod: 'TRANSFER',
      lines: [{ productId: colaId, quantity: 10, unitCost: 1_000 }],
    }).expect(201);
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 100_000 }).expect(201);
    await send(cashier, 'post', '/sales/checkout', {
      clientRequestId: randomUUID(),
      lines: [{ productId: colaId, quantity: 3 }],
      expectedTotal: 9_000,
      payments: [{ method: 'CASH', amount: 9_000 }],
    }).expect(201);
    // Una compra posterior más cara cambia el último costo, no el costo de lo ya vendido.
    await purchase(admin, {
      supplierId,
      paymentMethod: 'TRANSFER',
      lines: [{ productId: colaId, quantity: 10, unitCost: 1_500 }],
    }).expect(201);

    const sale = await SaleModel.findOne({ status: 'PAID' });
    expect(sale?.lines[0]?.unitCost).toBe(1_000);
    const sales = listSalesResponseSchema.parse((await cashier.agent.get('/api/v1/sales')).body);
    expect(JSON.stringify(sales)).not.toContain('unitCost');

    const today = toBusinessDate();
    const report = businessReportSchema.parse(
      (await admin.agent.get(`/api/v1/reports/business?from=${today}&to=${today}`)).body,
    );
    expect(report.costOfSales).toBe(3 * 1_000);
  });
});

describe('anular una compra', () => {
  const voidPurchase = (who: LoggedIn, id: string, body: object) =>
    send(who, 'post', `/purchases/${id}/void`, body);

  it('pide PIN y motivo, devuelve el stock y el efectivo a la caja abierta', async () => {
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 100_000 }).expect(201);
    const created = purchaseResponseSchema.parse(
      (
        await purchase(cashier, {
          supplierId,
          paymentMethod: 'CASH_DRAWER',
          lines: [{ productId: colaId, quantity: 10, unitCost: 1_800 }],
        }).expect(201)
      ).body,
    ).purchase;
    expect(created.status).toBe('ACTIVE');

    const noReason = await voidPurchase(cashier, created.id, { approverPin: ADMIN_PIN });
    expect(noReason.status).toBe(400);
    const noPin = await voidPurchase(cashier, created.id, { reason: 'Llegó vencida' });
    expect(noPin.status).toBe(403);
    expect(errorOf(noPin.body).code).toBe('APPROVAL_REQUIRED');

    const response = await voidPurchase(cashier, created.id, {
      reason: 'Llegó vencida',
      approverPin: ADMIN_PIN,
    });
    expect(response.status).toBe(200);
    const voided = purchaseResponseSchema.parse(response.body).purchase;
    expect(voided).toMatchObject({
      status: 'VOIDED',
      voidReason: 'Llegó vencida',
      voidCashRefunded: true,
    });
    expect((await InventoryItemModel.findOne({ productId: colaId }))?.quantity).toBe(0);
    expect(await StockMovementModel.countDocuments({ type: 'PURCHASE_VOID' })).toBe(1);

    const movements = listCashMovementsResponseSchema.parse(
      (await cashier.agent.get('/api/v1/cash-shifts/current/movements')).body,
    ).items;
    expect(movements.find((movement) => movement.type === 'INCOME')).toMatchObject({
      amount: 18_000,
      conceptName: 'Reintegro',
    });
    const shift = currentCashShiftResponseSchema.parse(
      (await cashier.agent.get('/api/v1/cash-shifts/current')).body,
    ).shift;
    expect(shift?.summary.expectedCash).toBe(100_000);

    const again = await voidPurchase(admin, created.id, { reason: 'Otra vez' });
    expect(again.status).toBe(409);
    expect(await AuditLogModel.countDocuments({ action: 'PURCHASE_VOIDED' })).toBe(1);

    // El reporte ya no la cuenta como compra ni el reintegro como ingreso.
    const today = toBusinessDate();
    const report = businessReportSchema.parse(
      (await admin.agent.get(`/api/v1/reports/business?from=${today}&to=${today}`)).body,
    );
    expect(report.purchasesBySupplier).toEqual([]);
    expect(report.incomesTotal).toBe(0);
  });

  it('no deja el stock negativo si ya se vendió lo comprado', async () => {
    const created = purchaseResponseSchema.parse(
      (
        await purchase(admin, {
          supplierId,
          paymentMethod: 'TRANSFER',
          lines: [{ productId: colaId, quantity: 2, unitCost: 1_000 }],
        }).expect(201)
      ).body,
    ).purchase;
    await InventoryItemModel.updateOne({ productId: colaId }, { $set: { quantity: 1 } });
    const response = await voidPurchase(admin, created.id, { reason: 'Error de digitación' });
    expect(response.status).toBe(409);
    expect(errorOf(response.body).message).toContain('Big Cola');
    expect((await InventoryItemModel.findOne({ productId: colaId }))?.quantity).toBe(1);
    expect((await PurchaseModel.findById(created.id))?.status).toBe('ACTIVE');
  });

  it('si la caja ya se cerró, anula pero no toca el efectivo', async () => {
    const created = purchaseResponseSchema.parse(
      (
        await purchase(admin, {
          supplierId,
          paymentMethod: 'TRANSFER',
          lines: [{ productId: colaId, quantity: 3, unitCost: 1_000 }],
        }).expect(201)
      ).body,
    ).purchase;
    // Simula una compra pagada con una caja que ya se cerró.
    const closedShift = new Types.ObjectId();
    await PurchaseModel.updateOne(
      { _id: created.id },
      { $set: { paymentMethod: 'CASH_DRAWER', shiftId: closedShift } },
    );
    const voided = purchaseResponseSchema.parse(
      (await voidPurchase(admin, created.id, { reason: 'Proveedor equivocado' }).expect(200)).body,
    ).purchase;
    expect(voided).toMatchObject({ status: 'VOIDED', voidCashRefunded: false });
    expect(await CashMovementModel.countDocuments({ type: 'INCOME' })).toBe(0);
  });

  it('las compras viejas sin estado se leen como vigentes', async () => {
    await purchase(admin, {
      supplierId,
      paymentMethod: 'TRANSFER',
      lines: [{ productId: colaId, quantity: 1, unitCost: 1_000 }],
    }).expect(201);
    await PurchaseModel.collection.updateMany({}, { $unset: { status: '', voidReason: '' } });
    const today = toBusinessDate();
    const list = listPurchasesResponseSchema.parse(
      (await admin.agent.get(`/api/v1/purchases?from=${today}&to=${today}`)).body,
    );
    expect(list.items[0]).toMatchObject({ status: 'ACTIVE', voidReason: '' });
  });
});

describe('devoluciones a proveedor', () => {
  const giveBack = (who: LoggedIn, body: object) => send(who, 'post', '/supplier-returns', body);

  beforeEach(async () => {
    await InventoryItemModel.create({ productId: colaId, quantity: 10 });
  });

  it('con efectivo: baja el stock y el reintegro entra a la caja abierta', async () => {
    const body = {
      supplierId,
      refundMethod: 'CASH_DRAWER',
      note: 'Venían golpeadas',
      lines: [{ productId: colaId, quantity: 4, unitCost: 1_800 }],
    };
    const closed = await giveBack(cashier, body);
    expect(closed.status).toBe(409);
    expect(errorOf(closed.body).code).toBe('CASH_SHIFT_REQUIRED');

    await send(cashier, 'post', '/cash-shifts', { openingAmount: 50_000 }).expect(201);
    const response = await giveBack(cashier, body);
    expect(response.status).toBe(201);
    expect(supplierReturnResponseSchema.parse(response.body).supplierReturn).toMatchObject({
      number: 1,
      total: 7_200,
      refundMethod: 'CASH_DRAWER',
      lines: [{ name: 'Big Cola', quantity: 4 }],
    });
    expect((await InventoryItemModel.findOne({ productId: colaId }))?.quantity).toBe(6);
    expect(await StockMovementModel.countDocuments({ type: 'SUPPLIER_RETURN' })).toBe(1);
    const shift = currentCashShiftResponseSchema.parse(
      (await cashier.agent.get('/api/v1/cash-shifts/current')).body,
    ).shift;
    expect(shift?.summary.expectedCash).toBe(57_200);
    expect(await AuditLogModel.countDocuments({ action: 'SUPPLIER_RETURN_CREATED' })).toBe(1);

    const today = toBusinessDate();
    const list = listSupplierReturnsResponseSchema.parse(
      (await cashier.agent.get(`/api/v1/supplier-returns?from=${today}&to=${today}`)).body,
    );
    expect(list).toMatchObject({ total: 7_200, items: [{ number: 1 }] });
  });

  it('como saldo a favor no toca la caja y nunca deja el stock negativo', async () => {
    const tooMany = await giveBack(admin, {
      supplierId,
      refundMethod: 'CREDIT',
      lines: [{ productId: colaId, quantity: 11, unitCost: 1_000 }],
    });
    expect(tooMany.status).toBe(409);
    expect((await InventoryItemModel.findOne({ productId: colaId }))?.quantity).toBe(10);

    await giveBack(admin, {
      supplierId,
      refundMethod: 'CREDIT',
      lines: [{ productId: colaId, quantity: 10, unitCost: 1_000 }],
    }).expect(201);
    expect((await InventoryItemModel.findOne({ productId: colaId }))?.quantity).toBe(0);
    expect(await CashMovementModel.countDocuments({})).toBe(0);
  });
});
