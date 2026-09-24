import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  cashMovementResponseSchema,
  cashShiftResponseSchema,
  currentCashShiftResponseSchema,
  listCashMovementsResponseSchema,
  slugify,
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
import { CategoryModel, ProductModel } from '../catalog/catalog.models';

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);
const errorOf = (body: unknown) => apiErrorResponseSchema.parse(body).error;

const ADMIN_PIN = '731940';

let stopDatabase: (() => Promise<void>) | undefined;
let admin: LoggedIn;
let cashier: LoggedIn;
let breadId: string;

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
  const bakery = await CategoryModel.create({ name: 'Panadería', slug: 'panaderia' });
  const bread = await ProductModel.create({
    name: 'Pan de bono',
    slug: slugify('Pan de bono'),
    categoryId: bakery._id,
    price: 2_000,
  });
  breadId = bread.id;
});

const send = (
  who: LoggedIn,
  method: 'post' | 'patch' | 'put' | 'delete',
  path: string,
  body?: object,
) => who.agent[method](`/api/v1${path}`).set('X-CSRF-Token', who.csrfToken).send(body);

const auditCount = (action: AuditAction) => AuditLogModel.countDocuments({ action });
const openShift = (who: LoggedIn, openingAmount = 100_000) =>
  send(who, 'post', '/cash-shifts', { openingAmount });
const move = (who: LoggedIn, body: object) =>
  send(who, 'post', '/cash-shifts/current/movements', body);
const close = (who: LoggedIn, body: object) =>
  send(who, 'post', '/cash-shifts/current/close', body);
const currentOf = async (who: LoggedIn) =>
  currentCashShiftResponseSchema.parse((await who.agent.get('/api/v1/cash-shifts/current')).body)
    .shift;

const sale = (quantity: number) => ({
  clientRequestId: randomUUID(),
  lines: [{ productId: breadId, quantity }],
  expectedTotal: 2_000 * quantity,
  payments: [{ method: 'CASH', amount: 2_000 * quantity }],
});

describe('egresos y retiros', () => {
  it('exigen la caja abierta', async () => {
    const response = await move(cashier, { type: 'EXPENSE', amount: 5_000, reason: 'Hielo' });
    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('CASH_SHIFT_REQUIRED');
  });

  it('la cajera registra un egreso menor con motivo y baja el efectivo esperado', async () => {
    await openShift(cashier).expect(201);
    const response = await move(cashier, { type: 'EXPENSE', amount: 12_000, reason: 'Hielo' });
    expect(response.status).toBe(201);
    expect(cashMovementResponseSchema.parse(response.body).movement).toMatchObject({
      type: 'EXPENSE',
      amount: 12_000,
      reason: 'Hielo',
      createdBy: 'Laura Gómez',
      approvedBy: null,
    });
    expect((await currentOf(cashier))?.summary).toMatchObject({
      expensesTotal: 12_000,
      expectedCash: 88_000,
    });
    expect(await auditCount('CASH_MOVEMENT_CREATED')).toBe(1);

    const list = await cashier.agent.get('/api/v1/cash-shifts/current/movements').expect(200);
    expect(listCashMovementsResponseSchema.parse(list.body).items).toHaveLength(1);
  });

  it('valida monto y motivo', async () => {
    await openShift(cashier).expect(201);
    expect((await move(cashier, { type: 'EXPENSE', amount: 0, reason: 'Hielo' })).status).toBe(400);
    expect((await move(cashier, { type: 'EXPENSE', amount: 1_000, reason: '  ' })).status).toBe(
      400,
    );
    expect((await move(cashier, { type: 'EXPENSE', amount: 1.5, reason: 'Hielo' })).status).toBe(
      400,
    );
  });

  it('un egreso sobre el tope necesita el PIN de un administrador', async () => {
    await openShift(cashier, 200_000).expect(201);
    const body = { type: 'EXPENSE', amount: 60_000, reason: 'Compra de harina' };

    const without = await move(cashier, body);
    expect(without.status).toBe(403);
    expect(errorOf(without.body).code).toBe('APPROVAL_REQUIRED');

    const wrong = await move(cashier, { ...body, approverPin: '000111' });
    expect(wrong.status).toBe(403);
    expect(errorOf(wrong.body).code).toBe('INVALID_PIN');
    expect(await auditCount('APPROVAL_FAILED')).toBe(1);

    const ok = await move(cashier, { ...body, approverPin: ADMIN_PIN });
    expect(ok.status).toBe(201);
    expect(cashMovementResponseSchema.parse(ok.body).movement.approvedBy).not.toBeNull();
  });

  it('el tope se cambia en Ajustes', async () => {
    await send(admin, 'patch', '/settings', { maxCashierExpense: 10_000 }).expect(200);
    await openShift(cashier).expect(201);
    const response = await move(cashier, { type: 'EXPENSE', amount: 15_000, reason: 'Gas' });
    expect(response.status).toBe(403);
    expect(errorOf(response.body).code).toBe('APPROVAL_REQUIRED');
  });

  it('los retiros siempre necesitan a un administrador, aunque sean pequeños', async () => {
    await openShift(cashier).expect(201);
    const body = { type: 'WITHDRAWAL', amount: 20_000, reason: 'Guardar en caja fuerte' };
    expect((await move(cashier, body)).status).toBe(403);

    const ok = await move(cashier, { ...body, approverPin: ADMIN_PIN });
    expect(ok.status).toBe(201);
    expect((await currentOf(cashier))?.summary).toMatchObject({
      withdrawalsTotal: 20_000,
      expectedCash: 80_000,
    });
  });

  it('el administrador se autoriza solo en su propia caja', async () => {
    await openShift(admin).expect(201);
    const ok = await move(admin, { type: 'WITHDRAWAL', amount: 30_000, reason: 'Depósito' });
    expect(ok.status).toBe(201);
  });

  it('no deja sacar más efectivo del que hay', async () => {
    await openShift(cashier, 20_000).expect(201);
    const response = await move(cashier, { type: 'EXPENSE', amount: 25_000, reason: 'Proveedor' });
    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('CONFLICT');
    expect((await currentOf(cashier))?.summary.expensesTotal).toBe(0);
  });

  it('dos retiros a la vez no sacan más efectivo del que hay', async () => {
    await openShift(admin, 50_000).expect(201);
    const [first, second] = await Promise.all([
      move(admin, { type: 'WITHDRAWAL', amount: 40_000, reason: 'Consignación' }),
      move(admin, { type: 'WITHDRAWAL', amount: 40_000, reason: 'Consignación' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect((await currentOf(admin))?.summary).toMatchObject({
      withdrawalsTotal: 40_000,
      expectedCash: 10_000,
    });
  });
});

describe('cierre de caja con arqueo', () => {
  const fullBill = [{ denomination: 100_000, quantity: 1 }];

  it('cuadra exacto sin nota: base + efectivo de ventas − egresos', async () => {
    await openShift(cashier).expect(201);
    await send(cashier, 'post', '/sales/checkout', sale(3)).expect(201); // +6.000
    await move(cashier, { type: 'EXPENSE', amount: 6_000, reason: 'Hielo' }).expect(201);

    const response = await close(cashier, { counts: fullBill }); // esperado 100.000
    expect(response.status).toBe(200);
    const { shift } = cashShiftResponseSchema.parse(response.body);
    expect(shift.status).toBe('CLOSED');
    expect(shift.closedAt).not.toBeNull();
    expect(shift.closing).toMatchObject({
      countedCash: 100_000,
      expectedCash: 100_000,
      difference: 0,
      note: '',
    });
    expect(await auditCount('CASH_SHIFT_CLOSED')).toBe(1);
    expect(await currentOf(cashier)).toBeNull();
  });

  it('suma las denominaciones y registra el sobrante con su nota', async () => {
    await openShift(cashier).expect(201);
    const counts = [
      { denomination: 100_000, quantity: 1 },
      { denomination: 10_000, quantity: 1 },
      { denomination: 2_000, quantity: 3 },
    ]; // 116.000 contra 100.000 esperados

    expect((await close(cashier, { counts })).status).toBe(400);
    expect((await currentOf(cashier))?.status).toBe('OPEN');

    const ok = await close(cashier, { counts, note: 'Sobró un pago de un cliente' });
    expect(ok.status).toBe(200);
    expect(cashShiftResponseSchema.parse(ok.body).shift.closing).toMatchObject({
      countedCash: 116_000,
      expectedCash: 100_000,
      difference: 16_000,
      note: 'Sobró un pago de un cliente',
    });
  });

  it('un faltante queda registrado como diferencia negativa', async () => {
    await openShift(cashier).expect(201);
    const ok = await close(cashier, {
      counts: [{ denomination: 50_000, quantity: 1 }],
      note: 'Se pagó un proveedor sin registrar',
    });
    expect(ok.status).toBe(200);
    expect(cashShiftResponseSchema.parse(ok.body).shift.closing).toMatchObject({
      countedCash: 50_000,
      difference: -50_000,
    });
  });

  it('no cierra con mesas abiertas', async () => {
    await openShift(cashier).expect(201);
    await send(cashier, 'post', '/tabs', { tableNumber: 1 }).expect(201);
    const response = await close(cashier, { counts: fullBill });
    expect(response.status).toBe(409);
    expect((await currentOf(cashier))?.status).toBe('OPEN');
  });

  it('valida las denominaciones', async () => {
    await openShift(cashier).expect(201);
    expect((await close(cashier, { counts: [{ denomination: 3_000, quantity: 1 }] })).status).toBe(
      400,
    );
    const repeated = [
      { denomination: 5_000, quantity: 1 },
      { denomination: 5_000, quantity: 2 },
    ];
    expect((await close(cashier, { counts: repeated })).status).toBe(400);
    expect((await close(cashier, { counts: [{ denomination: 5_000, quantity: -1 }] })).status).toBe(
      400,
    );
  });

  it('una caja cerrada no admite más ventas, egresos ni un segundo cierre', async () => {
    await openShift(cashier).expect(201);
    await close(cashier, { counts: fullBill }).expect(200);

    const late = await send(cashier, 'post', '/sales/checkout', sale(1));
    expect(errorOf(late.body).code).toBe('CASH_SHIFT_REQUIRED');
    expect((await move(cashier, { type: 'EXPENSE', amount: 1_000, reason: 'Hielo' })).status).toBe(
      409,
    );
    expect((await close(cashier, { counts: [] })).status).toBe(409);
  });

  it('una venta y el cierre a la vez: la venta nunca queda en una caja cerrada', async () => {
    await openShift(cashier).expect(201);
    const [sold, closed] = await Promise.all([
      send(cashier, 'post', '/sales/checkout', sale(1)),
      close(cashier, { counts: fullBill, note: 'Cierre con venta simultánea' }),
    ]);
    expect(closed.status).toBe(200);
    const { shift } = cashShiftResponseSchema.parse(closed.body);
    if (sold.status === 201) {
      // La venta entró antes del cierre: el arqueo la cuenta.
      expect(shift.summary.salesCount).toBe(1);
      expect(shift.closing?.expectedCash).toBe(102_000);
    } else {
      expect(errorOf(sold.body).code).toBe('CASH_SHIFT_REQUIRED');
      expect(shift.summary.salesCount).toBe(0);
    }
  });

  it('después de cerrar se puede abrir una caja nueva', async () => {
    await openShift(cashier).expect(201);
    await close(cashier, { counts: fullBill }).expect(200);
    await openShift(cashier, 50_000).expect(201);
  });

  it('exige sesión', async () => {
    await request(app).post('/api/v1/cash-shifts/current/close').send({ counts: [] }).expect(401);
  });
});
