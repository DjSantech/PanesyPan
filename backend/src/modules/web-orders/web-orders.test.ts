import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  createWebOrderResponseSchema,
  isInDeliveryZone,
  listWebOrdersResponseSchema,
  OUT_OF_ZONE_MESSAGE,
  saleSchema,
  toBusinessDate,
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
import { CashShiftModel } from '../cash/cash-shift.model';
import { CategoryModel, DailyMenuModel, ProductModel } from '../catalog/catalog.models';
import { SaleModel } from '../sales/sale.model';
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
    // Entregado solo se alcanza al cobrar el pedido, no con un cambio de estado.
    expect((await patch('DELIVERED')).status).toBe(409);

    const filtered = await cashier.agent.get('/api/v1/web-orders?status=PENDING').expect(200);
    expect(listWebOrdersResponseSchema.parse(filtered.body).orders).toHaveLength(0);

    const audits = await AuditLogModel.find({ action: 'WEB_ORDER_STATUS_CHANGED' }).lean();
    expect(audits).toHaveLength(2);
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

describe('cobro y cancelación de pedidos web', () => {
  let cashier: LoggedIn;
  let lunch: Types.ObjectId;
  let broth: Types.ObjectId;
  const choice = { protein: 'Pollo asado', principle: 'Fríjoles', soup: 'Sancocho' };

  beforeEach(async () => {
    cashier = await loginAs('CASHIER');
    const lunches = await category('Almuerzos', { kind: 'LUNCH' });
    lunch = (await product('Almuerzo del día', lunches._id, { price: 14_000 }))._id;
    broth = (await product('Caldo', lunches._id, { price: 6_000 }))._id;
  });

  const publishMenu = (extra: Record<string, unknown> = {}) =>
    DailyMenuModel.create({
      date: toBusinessDate(),
      isPublished: true,
      soups: [{ name: 'Sancocho' }],
      principles: [{ name: 'Fríjoles' }, { name: 'Lentejas', isAvailable: false }],
      proteins: [{ name: 'Pollo asado' }],
      offerings: [
        { productId: lunch, portions: 2, sold: 0 },
        { productId: broth, portions: null, sold: 0, withChoices: false },
      ],
      ...extra,
    });

  const send = (path: string, body: object) =>
    cashier.agent.post(`/api/v1${path}`).set('X-CSRF-Token', cashier.csrfToken).send(body);

  async function confirmedOrder(lines: object[] = [{ productId: bread.toString(), quantity: 2 }]) {
    const response = await postOrder(orderBody({ lines }));
    expect(response.status).toBe(201);
    const number = numberOf(response.body);
    await WebOrderModel.updateOne({ number }, { $set: { status: 'CONFIRMED' } });
    const order = await WebOrderModel.findOne({ number });
    if (order === null) throw new Error('Sin pedido');
    return order.id;
  }

  const checkoutBody = (expectedTotal: number, extra: object = {}) => ({
    clientRequestId: randomUUID(),
    expectedTotal,
    payments: [{ method: 'CASH', amount: expectedTotal }],
    deliveryFee: 3_000,
    ...extra,
  });

  const checkout = (id: string, body: object) => send(`/web-orders/${id}/checkout`, body);
  const openShift = () => send('/cash-shifts', { openingAmount: 100_000 }).expect(201);
  const saleOf = (body: unknown) => saleSchema.parse((body as { sale: unknown }).sale);

  it('cobra el pedido: venta en la caja con el número del pedido, domicilio aparte', async () => {
    await openShift();
    const id = await confirmedOrder();
    const response = await checkout(id, checkoutBody(1_600));
    expect(response.status).toBe(201);
    const { order } = webOrderResponseSchema.parse({
      order: (response.body as { order: unknown }).order,
    });
    const sale = saleOf(response.body);
    expect(sale).toMatchObject({ status: 'PAID', total: 1_600, webOrderNumber: 1 });
    expect(order).toMatchObject({
      status: 'DELIVERED',
      deliveryFee: 3_000,
      sale: { id: sale.id, number: sale.number },
    });
    const stored = await SaleModel.findById(sale.id);
    const shift = await CashShiftModel.findOne({ status: 'OPEN' });
    expect(stored?.shiftId?.equals(shift?._id)).toBe(true);
    const history = (await WebOrderModel.findById(id))?.statusHistory;
    expect(history?.at(-1)?.status).toBe('DELIVERED');
    expect(await AuditLogModel.countDocuments({ action: 'WEB_ORDER_CHARGED' })).toBe(1);
    const list = await cashier.agent.get('/api/v1/web-orders').expect(200);
    expect(listWebOrdersResponseSchema.parse(list.body).orders[0]?.sale?.number).toBe(sale.number);
  });

  it('es idempotente: el reintento devuelve la misma venta', async () => {
    await openShift();
    const id = await confirmedOrder();
    const body = checkoutBody(1_600);
    expect((await checkout(id, body)).status).toBe(201);
    const again = await checkout(id, body);
    expect(again.status).toBe(200);
    expect(await SaleModel.countDocuments()).toBe(1);
    expect((await checkout(id, checkoutBody(1_600))).status).toBe(409);
  });

  it('sin caja abierta o en estado inválido no cobra', async () => {
    const id = await confirmedOrder();
    expect((await checkout(id, checkoutBody(1_600))).status).toBe(409);
    await openShift();
    await WebOrderModel.updateOne({ _id: id }, { $set: { status: 'PENDING' } });
    expect((await checkout(id, checkoutBody(1_600))).status).toBe(409);
    expect(await SaleModel.countDocuments()).toBe(0);
  });

  it('usa el precio del pedido aunque el producto cambie; archivado → 409', async () => {
    await openShift();
    const id = await confirmedOrder();
    await ProductModel.updateOne({ _id: bread }, { $set: { price: 1_000 } });
    const response = await checkout(id, checkoutBody(1_600));
    expect(response.status).toBe(201);
    expect(saleOf(response.body).lines[0]?.unitPrice).toBe(800);

    const other = await confirmedOrder();
    await ProductModel.updateOne({ _id: bread }, { $set: { isActive: false } });
    expect((await checkout(other, checkoutBody(2_000))).status).toBe(409);
  });

  it('el almuerzo descuenta porciones al cobrar y falla si se agotaron', async () => {
    await publishMenu();
    await openShift();
    const line = { productId: lunch.toString(), quantity: 2, lunch: choice };
    const first = await confirmedOrder([line]);
    const second = await confirmedOrder([line]);
    const sold = async () =>
      (await DailyMenuModel.findOne({ date: toBusinessDate() }))?.offerings[0]?.sold;
    expect(await sold()).toBe(0);
    const response = await checkout(first, checkoutBody(28_000));
    expect(response.status).toBe(201);
    expect(saleOf(response.body).lines[0]?.lunch).toEqual(choice);
    expect(await sold()).toBe(2);
    const failed = await checkout(second, checkoutBody(28_000));
    expect(failed.status).toBe(409);
    expect(errorOf(failed.body).code).toBe('OUT_OF_STOCK');
    expect((await WebOrderModel.findById(second))?.status).toBe('CONFIRMED');
  });

  it('cancela con motivo, pero no un pedido ya cobrado', async () => {
    const id = await confirmedOrder();
    const canceled = await send(`/web-orders/${id}/cancel`, { reason: 'No contestó' });
    expect(canceled.status).toBe(200);
    expect(webOrderResponseSchema.parse(canceled.body).order).toMatchObject({
      status: 'CANCELED',
      cancelReason: 'No contestó',
    });
    expect(await AuditLogModel.countDocuments({ action: 'WEB_ORDER_CANCELED' })).toBe(1);
    expect((await send(`/web-orders/${id}/cancel`, { reason: 'Otra vez' })).status).toBe(409);

    await openShift();
    const paid = await confirmedOrder();
    expect((await checkout(paid, checkoutBody(1_600))).status).toBe(201);
    expect((await send(`/web-orders/${paid}/cancel`, { reason: 'Tarde' })).status).toBe(409);
  });

  it('pedido público con almuerzo: válido, sin elección, menú sin publicar y caldo', async () => {
    const line = (extra: object) => ({ productId: lunch.toString(), quantity: 1, ...extra });
    expect((await postOrder(orderBody({ lines: [line({ lunch: choice })] }))).status).toBe(409);

    await publishMenu();
    const ok = await postOrder(orderBody({ lines: [line({ lunch: choice })] }));
    expect(ok.status).toBe(201);
    expect(createWebOrderResponseSchema.parse(ok.body).order.lines[0]?.lunch).toEqual(choice);
    expect((await DailyMenuModel.findOne())?.offerings[0]?.sold).toBe(0);

    expect((await postOrder(orderBody({ lines: [line({})] }))).status).toBe(400);
    const brothLine = { productId: broth.toString(), quantity: 1 };
    expect((await postOrder(orderBody({ lines: [brothLine] }))).status).toBe(201);
    const brothWithChoice = { ...brothLine, lunch: choice };
    expect((await postOrder(orderBody({ lines: [brothWithChoice] }))).status).toBe(400);
  });

  it('pedido público con almuerzo agotado → 409', async () => {
    await publishMenu({ offerings: [{ productId: lunch, portions: 1, sold: 1 }] });
    const line = { productId: lunch.toString(), quantity: 1, lunch: choice };
    const response = await postOrder(orderBody({ lines: [line] }));
    expect(response.status).toBe(409);
    expect(errorOf(response.body).code).toBe('OUT_OF_STOCK');
  });
});
