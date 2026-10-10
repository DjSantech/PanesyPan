import {
  apiErrorResponseSchema,
  cashMovementResponseSchema,
  cashShiftDetailSchema,
  currentCashShiftResponseSchema,
  listCashMovementsResponseSchema,
  purchaseResponseSchema,
  supplierResponseSchema,
  type AuditAction,
} from '@panesypan/shared';
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

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);
const errorOf = (body: unknown) => apiErrorResponseSchema.parse(body).error;
const ADMIN_PIN = '731940';

// PNG de 1×1 píxel.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let stopDatabase: (() => Promise<void>) | undefined;
let admin: LoggedIn;
let cashier: LoggedIn;

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
});

afterAll(async () => {
  await stopDatabase?.();
});

beforeEach(async () => {
  await resetDatabase();
  await createTestUser({ username: 'admin', role: 'ADMIN', pin: ADMIN_PIN });
  await createTestUser({ username: 'laura', name: 'Laura Gómez', role: 'CASHIER' });
  admin = await login(app, 'admin', DEFAULT_PASSWORD);
  cashier = await login(app, 'laura', DEFAULT_PASSWORD);
});

const send = (who: LoggedIn, method: 'post' | 'patch', path: string, body?: object) =>
  who.agent[method](`/api/v1${path}`).set('X-CSRF-Token', who.csrfToken).send(body);
const upload = (who: LoggedIn, path: string, data: Buffer, type = 'image/png') =>
  who.agent
    .post(`/api/v1${path}`)
    .set('X-CSRF-Token', who.csrfToken)
    .set('Content-Type', type)
    .send(data);
const auditCount = (action: AuditAction) => AuditLogModel.countDocuments({ action });
const currentOf = async (who: LoggedIn) =>
  currentCashShiftResponseSchema.parse((await who.agent.get('/api/v1/cash-shifts/current')).body)
    .shift;
const createMovement = async (who: LoggedIn, body: object) =>
  cashMovementResponseSchema.parse(
    (await send(who, 'post', '/cash-shifts/current/movements', body).expect(201)).body,
  ).movement;

describe('corregir y anular movimientos de caja', () => {
  it('corrige el monto y el detalle con PIN y deja el antes y el después', async () => {
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 100_000 }).expect(201);
    const expense = await createMovement(cashier, {
      type: 'EXPENSE',
      amount: 12_000,
      reason: 'Hielo',
    });

    const withoutPin = await send(cashier, 'patch', `/cash-shifts/movements/${expense.id}`, {
      amount: 15_000,
    });
    expect(withoutPin.status).toBe(403);
    expect(errorOf(withoutPin.body).code).toBe('APPROVAL_REQUIRED');

    const response = await send(cashier, 'patch', `/cash-shifts/movements/${expense.id}`, {
      amount: 15_000,
      reason: 'Hielo y bolsas',
      approverPin: ADMIN_PIN,
    });
    expect(response.status).toBe(200);
    expect(cashMovementResponseSchema.parse(response.body).movement).toMatchObject({
      amount: 15_000,
      reason: 'Hielo y bolsas',
      status: 'ACTIVE',
    });
    expect((await currentOf(cashier))?.summary.expectedCash).toBe(85_000);
    const log = await AuditLogModel.findOne({ action: 'CASH_MOVEMENT_UPDATED' }).lean();
    expect(log?.metadata).toMatchObject({
      before: { amount: 12_000, reason: 'Hielo' },
      after: { amount: 15_000, reason: 'Hielo y bolsas' },
    });
  });

  it('anula con motivo: el registro queda y deja de contar en la caja y en el detalle', async () => {
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 100_000 }).expect(201);
    const income = await createMovement(cashier, {
      type: 'INCOME',
      amount: 20_000,
      reason: 'Base adicional',
    });
    const expense = await createMovement(cashier, {
      type: 'EXPENSE',
      amount: 10_000,
      reason: 'Hielo',
    });

    await send(cashier, 'post', `/cash-shifts/movements/${expense.id}/void`, {
      reason: 'x',
      approverPin: ADMIN_PIN,
    }).expect(400);
    const voided = await send(cashier, 'post', `/cash-shifts/movements/${expense.id}/void`, {
      reason: 'Se registró dos veces',
      approverPin: ADMIN_PIN,
    });
    expect(voided.status).toBe(200);
    expect(cashMovementResponseSchema.parse(voided.body).movement).toMatchObject({
      status: 'VOIDED',
      voidReason: 'Se registró dos veces',
    });
    const shift = await currentOf(cashier);
    expect(shift?.summary).toMatchObject({ expensesTotal: 0, expectedCash: 120_000 });

    // Ya anulado: no se toca más.
    await send(cashier, 'post', `/cash-shifts/movements/${expense.id}/void`, {
      reason: 'Otra vez',
      approverPin: ADMIN_PIN,
    }).expect(409);
    await send(cashier, 'patch', `/cash-shifts/movements/${expense.id}`, {
      amount: 1_000,
      approverPin: ADMIN_PIN,
    }).expect(409);

    const list = listCashMovementsResponseSchema.parse(
      (await cashier.agent.get('/api/v1/cash-shifts/current/movements')).body,
    ).items;
    expect(list).toHaveLength(2);
    expect(await auditCount('CASH_MOVEMENT_VOIDED')).toBe(1);

    const detail = cashShiftDetailSchema.parse(
      (await admin.agent.get(`/api/v1/cash-shifts/${shift?.id ?? ''}`)).body,
    );
    expect(detail.byConcept.every((row) => row.type === 'INCOME')).toBe(true);
    expect(income.status).toBe('ACTIVE');
  });

  it('no deja anular un ingreso si el efectivo ya salió', async () => {
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 0 }).expect(201);
    const income = await createMovement(cashier, {
      type: 'INCOME',
      amount: 20_000,
      reason: 'Base adicional',
    });
    await createMovement(cashier, { type: 'EXPENSE', amount: 15_000, reason: 'Hielo' });
    const response = await send(cashier, 'post', `/cash-shifts/movements/${income.id}/void`, {
      reason: 'Error',
      approverPin: ADMIN_PIN,
    });
    expect(response.status).toBe(409);
  });

  it('solo con la caja abierta y nunca el egreso de una compra', async () => {
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 100_000 }).expect(201);
    const supplierId = supplierResponseSchema.parse(
      (await send(admin, 'post', '/suppliers', { name: 'Surtiquesos' })).body,
    ).supplier.id;
    await send(cashier, 'post', '/purchases', {
      supplierId,
      paymentMethod: 'CASH_DRAWER',
      lines: [{ description: 'Queso', quantity: 1, unitCost: 10_000 }],
    }).expect(201);
    const [fromPurchase] = listCashMovementsResponseSchema.parse(
      (await cashier.agent.get('/api/v1/cash-shifts/current/movements')).body,
    ).items;
    expect(fromPurchase?.fromPurchase).toBe(true);
    const blocked = await send(
      cashier,
      'post',
      `/cash-shifts/movements/${fromPurchase?.id ?? ''}/void`,
      { reason: 'Error', approverPin: ADMIN_PIN },
    );
    expect(blocked.status).toBe(409);
    expect(errorOf(blocked.body).message).toContain('anula la compra');

    const expense = await createMovement(cashier, {
      type: 'EXPENSE',
      amount: 5_000,
      reason: 'Hielo',
    });
    await send(cashier, 'post', '/cash-shifts/current/close', {
      counts: [
        { denomination: 50_000, quantity: 1 },
        { denomination: 20_000, quantity: 1 },
        { denomination: 10_000, quantity: 1 },
        { denomination: 5_000, quantity: 1 },
      ],
    }).expect(200);
    const closed = await send(cashier, 'patch', `/cash-shifts/movements/${expense.id}`, {
      amount: 1_000,
      approverPin: ADMIN_PIN,
    });
    expect(closed.status).toBe(409);
  });
});

describe('foto del comprobante', () => {
  it('se adjunta a un egreso y se ve con sesión; solo imágenes de verdad', async () => {
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 100_000 }).expect(201);
    const expense = await createMovement(cashier, {
      type: 'EXPENSE',
      amount: 12_000,
      reason: 'Hielo',
    });
    const path = `/cash-shifts/current/movements/${expense.id}/receipt`;
    const fake = await upload(cashier, path, Buffer.from('<svg></svg>'));
    expect(fake.status).toBe(400);

    const response = await upload(cashier, path, PNG);
    expect(response.status).toBe(200);
    const { receipt } = cashMovementResponseSchema.parse(response.body).movement;
    expect(receipt?.url).toMatch(/^\/api\/v1\/receipts\//);
    expect(await auditCount('RECEIPT_ATTACHED')).toBe(1);

    const image = await cashier.agent.get(receipt?.url ?? '').expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    await request(app)
      .get(receipt?.url ?? '')
      .expect(401);
  });

  it('se adjunta a una compra', async () => {
    const supplierId = supplierResponseSchema.parse(
      (await send(admin, 'post', '/suppliers', { name: 'Surtiquesos' })).body,
    ).supplier.id;
    const created = purchaseResponseSchema.parse(
      (
        await send(admin, 'post', '/purchases', {
          supplierId,
          paymentMethod: 'TRANSFER',
          lines: [{ description: 'Queso', quantity: 1, unitCost: 10_000 }],
        }).expect(201)
      ).body,
    ).purchase;
    expect(created.receipt).toBeNull();
    const response = await upload(admin, `/purchases/${created.id}/receipt`, PNG);
    expect(response.status).toBe(200);
    expect(purchaseResponseSchema.parse(response.body).purchase.receipt).not.toBeNull();
  });
});
