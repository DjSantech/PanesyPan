import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  cashMovementResponseSchema,
  cashShiftResponseSchema,
  currentCashShiftResponseSchema,
  cashMovementLabel,
  cashShiftDetailSchema,
  listCashShiftsResponseSchema,
  saleResponseSchema,
  listCashConceptsResponseSchema,
  listCashMovementsResponseSchema,
  listSuppliersResponseSchema,
  supplierResponseSchema,
  slugify,
  staffMemberResponseSchema,
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

describe('proveedores y pagos con la caja', () => {
  const createSupplier = async (name: string) => {
    const response = await send(admin, 'post', '/suppliers', {
      name,
      documentType: 'NIT',
      documentNumber: '900081360',
      phone: '3128310953',
    });
    expect(response.status).toBe(201);
    return supplierResponseSchema.parse(response.body).supplier;
  };

  it('el administrador crea y archiva proveedores; la cajera solo los ve', async () => {
    const meals = await createSupplier('Meals');
    expect(meals).toMatchObject({ name: 'Meals', documentType: 'NIT', isActive: true });
    expect((await send(admin, 'post', '/suppliers', { name: 'meals' })).status).toBe(409);
    expect((await send(cashier, 'post', '/suppliers', { name: 'Otro' })).status).toBe(403);

    const archived = await send(admin, 'patch', `/suppliers/${meals.id}`, { isActive: false });
    expect(supplierResponseSchema.parse(archived.body).supplier.isActive).toBe(false);
    const visible = listSuppliersResponseSchema.parse(
      (await cashier.agent.get('/api/v1/suppliers')).body,
    );
    expect(visible.items).toHaveLength(0);
    expect(await auditCount('SUPPLIER_CREATED')).toBe(1);
    expect(await auditCount('SUPPLIER_UPDATED')).toBe(1);
  });

  it('un egreso queda a nombre del proveedor y no se pagan retiros ni archivados', async () => {
    const alpina = await createSupplier('Alpina');
    await openShift(cashier).expect(201);
    const paid = await move(cashier, {
      type: 'EXPENSE',
      amount: 20_000,
      reason: 'Pago a Alpina',
      supplierId: alpina.id,
    });
    expect(paid.status).toBe(201);
    expect(cashMovementResponseSchema.parse(paid.body).movement.supplier).toBe('Alpina');

    const withdrawal = await move(cashier, {
      type: 'WITHDRAWAL',
      amount: 5_000,
      reason: 'Guardar',
      supplierId: alpina.id,
      approverPin: ADMIN_PIN,
    });
    expect(withdrawal.status).toBe(400);

    await send(admin, 'patch', `/suppliers/${alpina.id}`, { isActive: false });
    const archived = await move(cashier, {
      type: 'EXPENSE',
      amount: 1_000,
      reason: 'Pago a Alpina',
      supplierId: alpina.id,
    });
    expect(archived.status).toBe(409);
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

describe('tipos de movimiento, personal e ingresos', () => {
  const conceptsOf = async (who: LoggedIn, all = false) =>
    listCashConceptsResponseSchema.parse(
      (await who.agent.get(`/api/v1/cash-concepts${all ? '?all=true' : ''}`)).body,
    ).items;
  const conceptNamed = async (name: string) => {
    const concept = (await conceptsOf(admin)).find((item) => item.name === name);
    if (concept === undefined) throw new Error(`Falta el tipo ${name}`);
    return concept;
  };

  it('arranca con los tipos de la panadería y la cajera solo ve los activos', async () => {
    const concepts = await conceptsOf(cashier);
    expect(concepts.map((concept) => concept.name)).toContain('Nómina / pago a trabajador');
    expect(concepts.some((concept) => concept.type === 'INCOME')).toBe(true);

    const ice = await conceptNamed('Hielo');
    await send(admin, 'patch', `/cash-concepts/${ice.id}`, { isActive: false }).expect(200);
    expect((await conceptsOf(cashier)).some((concept) => concept.id === ice.id)).toBe(false);
    expect((await conceptsOf(admin, true)).some((concept) => concept.id === ice.id)).toBe(true);
    expect(await auditCount('CASH_CONCEPT_UPDATED')).toBe(1);
  });

  it('solo el administrador crea tipos y no deja repetir el nombre', async () => {
    await send(cashier, 'post', '/cash-concepts', { name: 'Propinas', type: 'INCOME' }).expect(403);
    await send(admin, 'post', '/cash-concepts', { name: 'Propinas', type: 'INCOME' }).expect(201);
    const again = await send(admin, 'post', '/cash-concepts', { name: 'propinas', type: 'INCOME' });
    expect(again.status).toBe(409);
  });

  it('la nómina exige a la persona del personal y queda con su nombre', async () => {
    const payroll = await conceptNamed('Nómina / pago a trabajador');
    const member = staffMemberResponseSchema.parse(
      (await send(admin, 'post', '/staff', { name: 'Pedro Panadero', position: 'Panadero' })).body,
    ).member;
    await openShift(cashier).expect(201);

    const missing = await move(cashier, { type: 'EXPENSE', amount: 40_000, conceptId: payroll.id });
    expect(missing.status).toBe(400);

    const paid = await move(cashier, {
      type: 'EXPENSE',
      amount: 40_000,
      conceptId: payroll.id,
      staffId: member.id,
      reason: 'Día',
    });
    expect(paid.status).toBe(201);
    const movement = cashMovementResponseSchema.parse(paid.body).movement;
    expect(movement).toMatchObject({
      conceptName: 'Nómina / pago a trabajador',
      staffName: 'Pedro Panadero',
      reason: 'Día',
    });
    expect(cashMovementLabel(movement)).toBe('Nómina / pago a trabajador · Pedro Panadero (Día)');
  });

  it('no deja usar un tipo de otra clase', async () => {
    const rent = await conceptNamed('Arriendo');
    await openShift(cashier).expect(201);
    const response = await move(cashier, { type: 'INCOME', amount: 5_000, conceptId: rent.id });
    expect(response.status).toBe(400);
  });

  it('el ingreso sube el efectivo esperado sin pedir autorización', async () => {
    const extra = await conceptNamed('Base adicional');
    await openShift(cashier, 50_000).expect(201);
    await move(cashier, { type: 'INCOME', amount: 200_000, conceptId: extra.id }).expect(201);
    expect((await currentOf(cashier))?.summary).toMatchObject({
      incomesTotal: 200_000,
      expectedCash: 250_000,
    });
  });
});

describe('ciclo de caja: consecutivo, base para mañana, historial y confirmación', () => {
  it('numera las cajas y propone como base lo que dejó el último cierre', async () => {
    const opened = cashShiftResponseSchema.parse((await openShift(cashier, 50_000)).body).shift;
    expect(opened.number).toBe(1);

    const tooMuch = await close(cashier, {
      counts: [{ denomination: 50_000, quantity: 1 }],
      leftForNext: 60_000,
    });
    expect(tooMuch.status).toBe(400);
    await close(cashier, {
      counts: [{ denomination: 50_000, quantity: 1 }],
      leftForNext: 20_000,
    }).expect(200);

    const current = currentCashShiftResponseSchema.parse(
      (await cashier.agent.get('/api/v1/cash-shifts/current')).body,
    );
    expect(current).toMatchObject({ shift: null, suggestedOpeningAmount: 20_000 });
    const next = cashShiftResponseSchema.parse((await openShift(cashier, 20_000)).body).shift;
    expect(next.number).toBe(2);
  });

  it('el administrador ve el historial, el detalle y confirma una sola vez', async () => {
    const shift = cashShiftResponseSchema.parse((await openShift(cashier, 50_000)).body).shift;
    await move(cashier, { type: 'EXPENSE', amount: 5_000, reason: 'Hielo' }).expect(201);
    await close(cashier, {
      counts: [
        { denomination: 20_000, quantity: 2 },
        { denomination: 5_000, quantity: 1 },
      ],
    }).expect(200);

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    await cashier.agent.get(`/api/v1/cash-shifts?from=${today}&to=${today}`).expect(403);
    const list = listCashShiftsResponseSchema.parse(
      (await admin.agent.get(`/api/v1/cash-shifts?from=${today}&to=${today}`)).body,
    );
    expect(list.items.map((item) => item.id)).toContain(shift.id);

    const detail = cashShiftDetailSchema.parse(
      (await admin.agent.get(`/api/v1/cash-shifts/${shift.id}`)).body,
    );
    expect(detail.byConcept).toEqual([
      { type: 'EXPENSE', name: 'Sin tipo', amount: 5_000, count: 1 },
    ]);

    await send(cashier, 'post', `/cash-shifts/${shift.id}/confirm`, {}).expect(403);
    const confirmed = await send(admin, 'post', `/cash-shifts/${shift.id}/confirm`, {
      note: 'Revisado',
    });
    expect(confirmed.status).toBe(200);
    expect(cashShiftResponseSchema.parse(confirmed.body).shift).toMatchObject({
      confirmNote: 'Revisado',
      confirmedBy: expect.any(String) as string,
    });
    await send(admin, 'post', `/cash-shifts/${shift.id}/confirm`, {}).expect(409);
    expect(await auditCount('CASH_SHIFT_CONFIRMED')).toBe(1);
  });
});

describe('devoluciones parciales', () => {
  it('devuelve unidades con PIN, saca el efectivo de la caja y no deja pasarse', async () => {
    await openShift(cashier).expect(201);
    const paid = await send(cashier, 'post', '/sales/checkout', sale(3));
    expect(paid.status).toBe(201);
    const sold = saleResponseSchema.parse(paid.body).sale;
    const lineId = sold.lines[0]?.id ?? '';

    const noPin = await send(cashier, 'post', `/sales/${sold.id}/returns`, {
      lines: [{ lineId, quantity: 1 }],
      reason: 'Venía quemado',
    });
    expect(noPin.status).toBe(403);

    const returned = await send(cashier, 'post', `/sales/${sold.id}/returns`, {
      lines: [{ lineId, quantity: 2 }],
      reason: 'Venía quemado',
      approverPin: ADMIN_PIN,
    });
    expect(returned.status).toBe(200);
    expect(saleResponseSchema.parse(returned.body).sale.returnedTotal).toBe(4_000);
    expect((await currentOf(cashier))?.summary).toMatchObject({
      returnsTotal: 4_000,
      cashRefundsTotal: 4_000,
      expectedCash: 100_000 + 6_000 - 4_000,
    });

    const tooMany = await send(cashier, 'post', `/sales/${sold.id}/returns`, {
      lines: [{ lineId, quantity: 2 }],
      reason: 'Otra vez',
      approverPin: ADMIN_PIN,
    });
    expect(tooMany.status).toBe(409);
    expect(await auditCount('SALE_RETURNED')).toBe(1);
  });
});

describe('apertura manual del cajón', () => {
  it('queda en la auditoría con quien la hizo, el motivo y la caja abierta', async () => {
    expect((await openShift(cashier)).status).toBe(201);
    const response = await send(cashier, 'post', '/cash-shifts/drawer-open', {
      reason: 'Dar cambio',
    });
    expect(response.status).toBe(204);
    const log = await AuditLogModel.findOne({ action: 'CASH_DRAWER_OPENED' }).lean();
    expect(log?.actor?.name).toBe('Laura Gómez');
    expect(log?.metadata).toEqual({ reason: 'Dar cambio' });
    expect(log?.entity?.type).toBe('CASH_SHIFT');
  });

  it('funciona sin caja abierta, valida el cuerpo y exige sesión', async () => {
    expect((await send(cashier, 'post', '/cash-shifts/drawer-open', {})).status).toBe(204);
    expect(
      (await send(cashier, 'post', '/cash-shifts/drawer-open', { reason: 'x'.repeat(201) })).status,
    ).toBe(400);
    expect(
      (await request(app).post('/api/v1/cash-shifts/drawer-open').send({})).status,
    ).toBeGreaterThanOrEqual(401);
    expect(await auditCount('CASH_DRAWER_OPENED')).toBe(1);
  });
});
