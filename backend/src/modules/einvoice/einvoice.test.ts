import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  businessSettingsResponseSchema,
  einvoiceStatusResponseSchema,
  electronicDocumentResponseSchema,
  listElectronicDocumentsResponseSchema,
  saleResponseSchema,
  slugify,
  type Sale,
  type TaxCode,
} from '@panesypan/shared';
import type { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { SaleModel } from '../sales/sale.model';
import { setProviderClientForTests } from './einvoice.config';
import { ElectronicDocumentModel } from './einvoice.model';
import { MAX_ATTEMPTS, processDueDocuments } from './einvoice.service';
import {
  ProviderRejectedError,
  ProviderUnavailableError,
  type EInvoiceProviderClient,
} from './providers/provider';

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);
const errorOf = (body: unknown) => apiErrorResponseSchema.parse(body).error;
const saleOf = (body: unknown) => saleResponseSchema.parse(body).sale;

let stopDatabase: (() => Promise<void>) | undefined;
let admin: LoggedIn;
let cashier: LoggedIn;
let products: { bread: string; coffee: string };

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await Promise.all([initModels(), ElectronicDocumentModel.init()]);
});

afterAll(async () => {
  await stopDatabase?.();
});

afterEach(() => {
  setProviderClientForTests('SIMULATED', null);
});

async function createProduct(
  name: string,
  categoryId: Types.ObjectId,
  price: number,
  tax: TaxCode | null,
): Promise<string> {
  const product = await ProductModel.create({ name, slug: slugify(name), categoryId, price, tax });
  return product.id;
}

beforeEach(async () => {
  await resetDatabase();
  await ElectronicDocumentModel.deleteMany({});
  await createTestUser({ username: 'admin', role: 'ADMIN' });
  await createTestUser({ username: 'laura', name: 'Laura Gómez', role: 'CASHIER' });
  admin = await login(app, 'admin', DEFAULT_PASSWORD);
  cashier = await login(app, 'laura', DEFAULT_PASSWORD);
  const bakery = await CategoryModel.create({ name: 'Panadería', slug: 'panaderia' });
  products = {
    bread: await createProduct('Pan de bono', bakery._id, 2_000, null),
    coffee: await createProduct('Café', bakery._id, 3_000, 'IVA_19'),
  };
});

const send = (who: LoggedIn, method: 'post' | 'patch', path: string, body?: object) =>
  who.agent[method](`/api/v1${path}`).set('X-CSRF-Token', who.csrfToken).send(body);

const enableEInvoicing = () =>
  send(admin, 'patch', '/settings', { einvoiceEnabled: true, defaultTax: 'INC_8' }).expect(200);

async function sell(extra: object = {}): Promise<Sale> {
  const response = await send(cashier, 'post', '/sales/checkout', {
    clientRequestId: randomUUID(),
    lines: [
      { productId: products.bread, quantity: 2 },
      { productId: products.coffee, quantity: 1 },
    ],
    expectedTotal: 7_000,
    payments: [{ method: 'CASH', amount: 7_000 }],
    ...extra,
  });
  expect(response.status).toBe(201);
  return saleOf(response.body);
}

const saleById = async (id: string) =>
  saleOf((await admin.agent.get(`/api/v1/sales/${id}`).expect(200)).body);
const invoiceOf = (saleId: string) =>
  ElectronicDocumentModel.findOne({ saleId, kind: 'INVOICE' }).orFail();
const voidSale = (saleId: string) =>
  send(admin, 'post', `/sales/${saleId}/void`, { reason: 'Error de cobro' }).expect(200);

/** Proveedor de prueba que falla como se le indique. */
function failingProvider(error: Error): EInvoiceProviderClient {
  return {
    name: 'SIMULATED',
    environment: 'SIMULATED',
    issue: () => Promise.reject(error),
  };
}

describe('configuración', () => {
  it('se activa solo con el impuesto general y solo la cambia el administrador', async () => {
    const withoutTax = await send(admin, 'patch', '/settings', { einvoiceEnabled: true });
    expect(withoutTax.status).toBe(400);
    expect(errorOf(withoutTax.body).message).toContain('impuesto general');

    const byCashier = await send(cashier, 'patch', '/settings', { einvoiceEnabled: true });
    expect(byCashier.status).toBe(403);

    const saved = businessSettingsResponseSchema.parse((await enableEInvoicing()).body).settings;
    expect(saved).toMatchObject({
      einvoiceEnabled: true,
      einvoiceProvider: 'SIMULATED',
      defaultTax: 'INC_8',
    });
  });

  it('no deja elegir Factus si el servidor no tiene sus credenciales', async () => {
    const response = await send(admin, 'patch', '/settings', {
      einvoiceEnabled: true,
      defaultTax: 'INC_8',
      einvoiceProvider: 'FACTUS',
      einvoiceNumberingRangeId: 8,
      einvoiceCreditNoteRangeId: 9,
    });
    expect(response.status).toBe(400);
    expect(errorOf(response.body).message).toContain('FACTUS_');

    const status = einvoiceStatusResponseSchema.parse(
      (await admin.agent.get('/api/v1/einvoices/status').expect(200)).body,
    );
    expect(status.availableProviders).toEqual(['SIMULATED']);
  });
});

describe('factura de cada venta', () => {
  it('apagada, las ventas no generan factura', async () => {
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 0 }).expect(201);
    const sale = await sell();
    expect(sale.einvoice).toBeNull();
    expect(await ElectronicDocumentModel.countDocuments()).toBe(0);
  });

  it('queda en cola en la misma transacción y se valida al procesar la cola', async () => {
    await enableEInvoicing();
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 0 }).expect(201);
    const sale = await sell();
    expect(sale.einvoice).toMatchObject({
      status: 'PENDING',
      environment: 'SIMULATED',
      cufe: null,
    });

    expect(await processDueDocuments()).toBe(1);
    const after = await saleById(sale.id);
    expect(after.einvoice).toMatchObject({
      status: 'ACCEPTED',
      number: `SIMU${String(sale.number)}`,
    });
    expect(after.einvoice?.cufe).toMatch(/^[0-9a-f]{96}$/);
    expect(after.einvoice?.qrData).toContain('SIMULADO');
  });

  it('usa el impuesto del producto o el general y reparte el descuento', async () => {
    await enableEInvoicing();
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 0 }).expect(201);
    const sale = await sell({
      discount: { mode: 'AMOUNT', value: 700, reason: 'Cliente frecuente' },
      expectedTotal: 6_300,
      payments: [{ method: 'CASH', amount: 6_300 }],
    });
    const { draft } = await invoiceOf(sale.id);
    expect(draft.lines.map((line) => [line.tax, line.gross, line.discount])).toEqual([
      ['INC_8', 4_000, 400],
      ['IVA_19', 3_000, 300],
    ]);
    expect(draft).toMatchObject({ total: 6_300, customer: null, referenceCode: `V-${sale.id}` });
  });

  it('factura a nombre del cliente con el dígito de verificación del NIT', async () => {
    await enableEInvoicing();
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 0 }).expect(201);
    const sale = await sell({
      customer: {
        idType: 'NIT',
        idNumber: '900.123.456',
        name: 'Cafetería La Esquina S.A.S.',
        email: 'Compras@LaEsquina.co',
      },
    });
    expect(sale.customer).toEqual({
      idType: 'NIT',
      idNumber: '900123456',
      checkDigit: 8,
      name: 'Cafetería La Esquina S.A.S.',
      email: 'compras@laesquina.co',
    });
    const { draft } = await invoiceOf(sale.id);
    expect(draft.customer?.idNumber).toBe('900123456');
    expect(draft.sendEmail).toBe(true);

    const wrongDv = await send(cashier, 'post', '/sales/checkout', {
      clientRequestId: randomUUID(),
      lines: [{ productId: products.bread, quantity: 1 }],
      expectedTotal: 2_000,
      payments: [{ method: 'CASH', amount: 2_000 }],
      customer: { idType: 'NIT', idNumber: '900123456', checkDigit: 3, name: 'Otra empresa' },
    });
    expect(wrongDv.status).toBe(400);
  });

  it('las mesas también se facturan al cobrarse', async () => {
    await enableEInvoicing();
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 0 }).expect(201);
    const tab = saleOf((await send(cashier, 'post', '/tabs', { tableNumber: 1 })).body);
    await send(cashier, 'post', `/tabs/${tab.id}/lines`, {
      productId: products.coffee,
      quantity: 2,
    }).expect(200);
    const paid = saleOf(
      (
        await send(cashier, 'post', `/tabs/${tab.id}/checkout`, {
          clientRequestId: randomUUID(),
          expectedTotal: 6_000,
          payments: [{ method: 'NEQUI', amount: 6_000 }],
        }).expect(200)
      ).body,
    );
    expect(paid.einvoice?.status).toBe('PENDING');
    await processDueDocuments();
    expect((await saleById(tab.id)).einvoice?.status).toBe('ACCEPTED');
  });
});

describe('anulaciones', () => {
  beforeEach(async () => {
    await enableEInvoicing();
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 0 }).expect(201);
  });

  it('si la factura no había salido, ya no se envía', async () => {
    const sale = await sell();
    await voidSale(sale.id);
    expect((await invoiceOf(sale.id)).status).toBe('CANCELED');
    expect(await processDueDocuments()).toBe(0);
    expect((await saleById(sale.id)).einvoice).toMatchObject({
      status: 'CANCELED',
      creditNote: null,
    });
  });

  it('si ya estaba validada, se emite la nota crédito', async () => {
    const sale = await sell();
    await processDueDocuments();
    await voidSale(sale.id);
    expect((await saleById(sale.id)).einvoice?.creditNote).toEqual({
      status: 'PENDING',
      number: null,
    });

    expect(await processDueDocuments()).toBe(1);
    const after = await saleById(sale.id);
    expect(after.einvoice).toMatchObject({
      status: 'ACCEPTED',
      creditNote: { status: 'ACCEPTED', number: `SIMUNC${String(sale.number)}` },
    });
    const note = await ElectronicDocumentModel.findOne({ kind: 'CREDIT_NOTE' }).orFail();
    expect(note.draft.lines).toEqual((await invoiceOf(sale.id)).draft.lines);
  });

  it('la nota crédito espera a que la factura se valide', async () => {
    const sale = await sell();
    setProviderClientForTests(
      'SIMULATED',
      failingProvider(new ProviderUnavailableError('Sin red')),
    );
    await processDueDocuments();
    await voidSale(sale.id);

    await processDueDocuments(); // la factura sigue sin red: la nota no se puede enviar todavía
    const note = await ElectronicDocumentModel.findOne({ kind: 'CREDIT_NOTE' }).orFail();
    expect(note).toMatchObject({ status: 'PENDING', attempts: 0 });

    // Vuelve la red: primero se valida la factura y después la nota crédito que la anula.
    setProviderClientForTests('SIMULATED', null);
    const later = Date.now() + 5 * 60_000;
    await processDueDocuments({ now: new Date(later) });
    await processDueDocuments({ now: new Date(later + 2 * 60_000) });
    expect((await saleById(sale.id)).einvoice).toMatchObject({
      status: 'ACCEPTED',
      creditNote: { status: 'ACCEPTED' },
    });
  });
});

describe('fallas y reintentos', () => {
  beforeEach(async () => {
    await enableEInvoicing();
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 0 }).expect(201);
  });

  it('una falla temporal se reintenta más tarde y al agotar los intentos queda sin enviar', async () => {
    const sale = await sell();
    setProviderClientForTests('SIMULATED', failingProvider(new ProviderUnavailableError('Caído')));

    await processDueDocuments();
    let invoice = await invoiceOf(sale.id);
    expect(invoice).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'Caído' });
    expect(invoice.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
    expect(await processDueDocuments()).toBe(0); // todavía no le toca

    let now = Date.now();
    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      now += 3 * 60 * 60_000;
      await processDueDocuments({ now: new Date(now) });
    }
    invoice = await invoiceOf(sale.id);
    expect(invoice).toMatchObject({
      status: 'FAILED',
      attempts: MAX_ATTEMPTS,
      nextAttemptAt: null,
    });
    expect((await saleById(sale.id)).einvoice).toMatchObject({
      status: 'FAILED',
      message: 'Caído',
    });
  });

  it('un rechazo queda para revisar y el administrador lo reenvía', async () => {
    const sale = await sell();
    setProviderClientForTests(
      'SIMULATED',
      failingProvider(new ProviderRejectedError('Rango de numeración vencido')),
    );
    await processDueDocuments();
    const invoice = await invoiceOf(sale.id);
    expect(invoice).toMatchObject({ status: 'REJECTED', lastError: 'Rango de numeración vencido' });

    const list = listElectronicDocumentsResponseSchema.parse(
      (await admin.agent.get('/api/v1/einvoices?status=REJECTED').expect(200)).body,
    );
    expect(list.items.map((item) => item.id)).toEqual([invoice.id]);

    setProviderClientForTests('SIMULATED', null);
    const retried = electronicDocumentResponseSchema.parse(
      (await send(admin, 'post', `/einvoices/${invoice.id}/retry`).expect(200)).body,
    ).document;
    expect(retried).toMatchObject({ status: 'PENDING', attempts: 0 });
    expect(await AuditLogModel.countDocuments({ action: 'EINVOICE_RETRIED' })).toBe(1);

    await processDueDocuments();
    expect((await saleById(sale.id)).einvoice?.status).toBe('ACCEPTED');
    const again = await send(admin, 'post', `/einvoices/${invoice.id}/retry`);
    expect(again.status).toBe(409);
  });

  it('un envío que quedó colgado (proceso caído) se retoma', async () => {
    const sale = await sell();
    await ElectronicDocumentModel.updateOne(
      { saleId: sale.id },
      { $set: { status: 'SENDING', lockedUntil: new Date(Date.now() - 1_000) } },
    );
    expect(await processDueDocuments()).toBe(1);
    expect((await invoiceOf(sale.id)).status).toBe('ACCEPTED');
  });

  it('el estado cuenta los documentos por estado', async () => {
    await sell();
    await sell();
    await processDueDocuments({ limit: 1 });
    const status = einvoiceStatusResponseSchema.parse(
      (await admin.agent.get('/api/v1/einvoices/status').expect(200)).body,
    );
    expect(status).toMatchObject({ enabled: true, provider: 'SIMULATED', providerReady: true });
    expect(status.counts).toMatchObject({ ACCEPTED: 1, PENDING: 1, REJECTED: 0 });
  });
});

describe('la venta guarda su factura aunque cambie el catálogo', () => {
  it('el borrador conserva el impuesto del momento de la venta', async () => {
    await enableEInvoicing();
    await send(cashier, 'post', '/cash-shifts', { openingAmount: 0 }).expect(201);
    const sale = await sell();
    await send(admin, 'patch', `/products/${products.coffee}`, { tax: 'IVA_5' }).expect(200);
    const { draft } = await invoiceOf(sale.id);
    expect(draft.lines[1]?.tax).toBe('IVA_19');
    expect((await SaleModel.findById(sale.id).orFail()).einvoice?.status).toBe('PENDING');
  });
});
