import {
  EINVOICE_STATUSES,
  type BusinessSettings,
  type EInvoiceStatus,
  type EInvoiceStatusResponse,
  type ElectronicDocument,
  type ListElectronicDocumentsQuery,
  type TaxCode,
} from '@panesypan/shared';
import { trusted, type ClientSession, type QueryFilter } from 'mongoose';
import type { Logger } from 'pino';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { ProductModel } from '../catalog/catalog.models';
import { SaleModel, type SaleDocument } from '../sales/sale.model';
import { getSettings } from '../settings/settings.service';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { buildDraft, creditNoteReference, type DocumentDraft } from './draft';
import {
  availableProviders,
  getProviderClient,
  isProviderAvailable,
  providerEnvironment,
} from './einvoice.config';
import {
  ElectronicDocumentModel,
  type ElectronicDocumentAttrs,
  type ElectronicDocumentDocument,
} from './einvoice.model';
import { ProviderRejectedError, type RelatedDocument } from './providers/provider';

/** Espera antes de cada reintento automático; al agotarlos el documento queda "Sin enviar". */
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** Tiempo máximo que un envío mantiene tomado el documento (si el proceso se cae, se retoma). */
const LOCK_MS = 120_000;
/** Una nota crédito espera a que su factura quede validada. */
const WAIT_FOR_INVOICE_MS = 60_000;
const ERROR_MAX = 500;

const truncate = (text: string): string =>
  text.length > ERROR_MAX ? `${text.slice(0, ERROR_MAX - 1)}…` : text;

// ── Encolar ──────────────────────────────────────────────────────────

async function taxesOf(
  sale: SaleDocument,
  session: ClientSession,
): Promise<Map<string, TaxCode | null>> {
  const products = await ProductModel.find({
    _id: trusted({ $in: sale.lines.map((line) => line.productId) }),
  })
    .select('tax')
    .session(session);
  return new Map(products.map((product) => [product.id, product.tax ?? null]));
}

/**
 * Crea la factura electrónica de una venta recién cobrada, dentro de la misma transacción:
 * si la venta se guarda, su factura queda en cola sí o sí (y si se aborta, ninguna de las dos).
 * Deja el resumen en la venta; quien llama la guarda.
 */
export async function enqueueInvoice(
  sale: SaleDocument,
  settings: BusinessSettings,
  session: ClientSession,
): Promise<void> {
  if (!settings.einvoiceEnabled || sale.number === null) return;
  const draft = buildDraft(
    'INVOICE',
    sale,
    await taxesOf(sale, session),
    settings,
    `Venta N.º ${String(sale.number)}`,
  );
  const provider = settings.einvoiceProvider;
  const [document] = await ElectronicDocumentModel.create(
    [
      {
        kind: 'INVOICE',
        status: 'PENDING',
        provider,
        environment: providerEnvironment(provider),
        saleId: sale._id,
        saleNumber: sale.number,
        referenceCode: draft.referenceCode,
        draft,
        nextAttemptAt: new Date(),
      },
    ],
    { session },
  );
  if (document === undefined) throw new Error('No se pudo encolar la factura electrónica');
  sale.einvoice = {
    documentId: document._id,
    status: 'PENDING',
    environment: document.environment,
    number: null,
    cufe: null,
    qrData: null,
    publicUrl: null,
    validatedAt: null,
    message: null,
    creditNote: null,
  };
}

/**
 * Al anular una venta:
 * - Si su factura nunca se intentó enviar, o la DIAN la rechazó, ya no se envía.
 * - Si ya salió, se está enviando o hubo algún intento (una falla de red puede ocultar que sí
 *   llegó), se encola una nota crédito que la anula ante la DIAN en cuanto la factura se valide.
 * Dentro de la transacción de la anulación; deja el resumen en la venta.
 */
export async function handleSaleVoided(
  sale: SaleDocument,
  reason: string,
  session: ClientSession,
): Promise<void> {
  const invoice = await ElectronicDocumentModel.findOne({
    saleId: sale._id,
    kind: 'INVOICE',
  }).session(session);
  if (invoice === null || sale.einvoice === null) return;

  const neverSent = invoice.status === 'PENDING' && invoice.attempts === 0;
  if (neverSent || invoice.status === 'REJECTED') {
    invoice.status = 'CANCELED';
    invoice.nextAttemptAt = null;
    invoice.lastError = 'Venta anulada antes de validar la factura';
    await invoice.save({ session });
    sale.einvoice.status = 'CANCELED';
    sale.einvoice.message = invoice.lastError;
    return;
  }
  if (invoice.status === 'CANCELED') return;

  // La nota crédito anula la factura completa: mismos productos, cliente y pagos.
  const settings = await getSettings();
  const draft: DocumentDraft = {
    ...invoice.draft,
    kind: 'CREDIT_NOTE',
    referenceCode: creditNoteReference(sale.id),
    issuedAt: new Date().toISOString(),
    observation: `Anulación de la venta N.º ${String(invoice.saleNumber)}: ${reason}`,
    numberingRangeId: settings.einvoiceCreditNoteRangeId,
  };

  const [note] = await ElectronicDocumentModel.create(
    [
      {
        kind: 'CREDIT_NOTE',
        status: 'PENDING',
        provider: invoice.provider,
        environment: invoice.environment,
        saleId: sale._id,
        saleNumber: invoice.saleNumber,
        referenceCode: draft.referenceCode,
        draft,
        invoiceId: invoice._id,
        nextAttemptAt: new Date(),
      },
    ],
    { session },
  );
  if (note === undefined) throw new Error('No se pudo encolar la nota crédito');
  sale.einvoice.creditNote = { documentId: note._id, status: 'PENDING', number: null };
}

// ── Enviar ───────────────────────────────────────────────────────────

/** Actualiza la copia del estado que guarda la venta. */
async function syncSale(document: ElectronicDocumentDocument): Promise<void> {
  if (document.kind === 'CREDIT_NOTE') {
    await SaleModel.updateOne(
      { _id: document.saleId, 'einvoice.creditNote.documentId': document._id },
      {
        $set: {
          'einvoice.creditNote.status': document.status,
          'einvoice.creditNote.number': document.result?.number ?? null,
        },
      },
    );
    return;
  }
  await SaleModel.updateOne(
    { _id: document.saleId, 'einvoice.documentId': document._id },
    {
      $set: {
        'einvoice.status': document.status,
        'einvoice.environment': document.environment,
        'einvoice.number': document.result?.number ?? null,
        'einvoice.cufe': document.result?.cufe ?? null,
        'einvoice.qrData': document.result?.qrData ?? null,
        'einvoice.publicUrl': document.result?.publicUrl ?? null,
        'einvoice.validatedAt': document.result?.validatedAt ?? null,
        'einvoice.message': document.status === 'ACCEPTED' ? null : document.lastError,
      },
    },
  );
}

/** Toma el siguiente documento listo para enviar (o uno cuyo envío quedó colgado). */
async function claimNext(now: Date): Promise<ElectronicDocumentDocument | null> {
  return ElectronicDocumentModel.findOneAndUpdate(
    {
      $or: [
        { status: 'PENDING', nextAttemptAt: trusted({ $lte: now }) },
        { status: 'SENDING', lockedUntil: trusted({ $lt: now }) },
      ],
    },
    { $set: { status: 'SENDING', lockedUntil: new Date(now.getTime() + LOCK_MS) } },
    { sort: { nextAttemptAt: 1, createdAt: 1 }, returnDocument: 'after' },
  );
}

type Settle = Partial<
  Pick<ElectronicDocumentAttrs, 'status' | 'nextAttemptAt' | 'lastError' | 'result' | 'attempts'>
>;

async function settle(document: ElectronicDocumentDocument, changes: Settle): Promise<void> {
  Object.assign(document, changes, { lockedUntil: null });
  await document.save();
  await syncSale(document);
}

/** La nota crédito necesita la factura validada; si la factura nunca salió, no hace falta. */
async function relatedInvoice(
  note: ElectronicDocumentDocument,
): Promise<RelatedDocument | 'WAIT' | 'NOT_NEEDED'> {
  const invoice =
    note.invoiceId === null ? null : await ElectronicDocumentModel.findById(note.invoiceId);
  if (invoice === null || invoice.status === 'CANCELED' || invoice.status === 'REJECTED') {
    return 'NOT_NEEDED';
  }
  if (invoice.status !== 'ACCEPTED' || invoice.result === null) return 'WAIT';
  return { number: invoice.result.number, cufe: invoice.result.cufe };
}

async function processDocument(
  document: ElectronicDocumentDocument,
  now: Date,
  logger?: Logger,
): Promise<void> {
  let related: RelatedDocument | null = null;
  if (document.kind === 'CREDIT_NOTE') {
    const invoice = await relatedInvoice(document);
    if (invoice === 'WAIT') {
      await settle(document, {
        status: 'PENDING',
        nextAttemptAt: new Date(now.getTime() + WAIT_FOR_INVOICE_MS),
      });
      return;
    }
    if (invoice === 'NOT_NEEDED') {
      await settle(document, {
        status: 'CANCELED',
        nextAttemptAt: null,
        lastError: 'La factura no quedó validada: no hay nada que anular',
      });
      return;
    }
    related = invoice;
  }

  const client = getProviderClient(document.provider);
  if (client === null) {
    await settle(document, {
      status: 'REJECTED',
      nextAttemptAt: null,
      lastError: 'El proveedor no está configurado en el servidor',
    });
    return;
  }

  const attempts = document.attempts + 1;
  try {
    const result = await client.issue({ draft: document.draft, related });
    await settle(document, {
      status: 'ACCEPTED',
      attempts,
      nextAttemptAt: null,
      lastError: null,
      result,
    });
    logger?.info(
      { kind: document.kind, saleNumber: document.saleNumber, number: result.number },
      'Documento electrónico validado',
    );
  } catch (error) {
    const message = truncate(error instanceof Error ? error.message : String(error));
    if (error instanceof ProviderRejectedError) {
      await settle(document, {
        status: 'REJECTED',
        attempts,
        nextAttemptAt: null,
        lastError: message,
      });
      logger?.warn({ saleNumber: document.saleNumber, reason: message }, 'Documento rechazado');
      return;
    }
    const delay = RETRY_DELAYS_MS[attempts - 1];
    await settle(document, {
      status: delay === undefined ? 'FAILED' : 'PENDING',
      attempts,
      nextAttemptAt: delay === undefined ? null : new Date(now.getTime() + delay),
      lastError: message,
    });
    logger?.warn(
      { saleNumber: document.saleNumber, attempts, reason: message },
      'No se pudo enviar el documento electrónico',
    );
  }
}

/** Envía los documentos pendientes, uno a la vez. Devuelve cuántos procesó. */
export async function processDueDocuments(
  options: { now?: Date; limit?: number; logger?: Logger } = {},
): Promise<number> {
  const limit = options.limit ?? 20;
  let processed = 0;
  while (processed < limit) {
    const now = options.now ?? new Date();
    const document = await claimNext(now);
    if (document === null) break;
    await processDocument(document, now, options.logger);
    processed += 1;
  }
  return processed;
}

// ── Administración ───────────────────────────────────────────────────

function toDocumentDto(document: ElectronicDocumentDocument): ElectronicDocument {
  return {
    id: document.id,
    kind: document.kind,
    status: document.status,
    provider: document.provider,
    environment: document.environment,
    saleId: document.saleId.toString(),
    saleNumber: document.saleNumber,
    total: document.draft.total,
    customerName: document.draft.customer?.name ?? 'Consumidor final',
    number: document.result?.number ?? null,
    cufe: document.result?.cufe ?? null,
    publicUrl: document.result?.publicUrl ?? null,
    attempts: document.attempts,
    lastError: document.lastError,
    nextAttemptAt: document.nextAttemptAt?.toISOString() ?? null,
    validatedAt: document.result?.validatedAt.toISOString() ?? null,
    createdAt: document.createdAt.toISOString(),
  };
}

export async function listDocuments(
  query: ListElectronicDocumentsQuery,
): Promise<ElectronicDocument[]> {
  const filter: QueryFilter<ElectronicDocumentAttrs> = {};
  if (query.status !== undefined) filter.status = query.status;
  if (query.kind !== undefined) filter.kind = query.kind;
  const documents = await ElectronicDocumentModel.find(filter).sort({ createdAt: -1 }).limit(300);
  return documents.map(toDocumentDto);
}

export async function getEInvoiceStatus(): Promise<EInvoiceStatusResponse> {
  const settings = await getSettings();
  const grouped = await ElectronicDocumentModel.aggregate<{ _id: EInvoiceStatus; count: number }>([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(EINVOICE_STATUSES.map((status) => [status, 0])) as Record<
    EInvoiceStatus,
    number
  >;
  for (const { _id, count } of grouped) counts[_id] = count;
  return {
    enabled: settings.einvoiceEnabled,
    provider: settings.einvoiceProvider,
    environment: providerEnvironment(settings.einvoiceProvider),
    providerReady: isProviderAvailable(settings.einvoiceProvider),
    availableProviders: availableProviders(),
    counts,
  };
}

/**
 * Reenvía un documento rechazado o sin enviar. Se vuelve a armar con la configuración actual
 * (rango de numeración, proveedor e impuestos), que es lo que se suele corregir.
 */
export async function retryDocument(id: string, ctx: ActorContext): Promise<ElectronicDocument> {
  const document = await ElectronicDocumentModel.findById(id);
  if (document === null) throw new AppError(404, 'NOT_FOUND', 'Documento no encontrado');
  if (document.status !== 'REJECTED' && document.status !== 'FAILED') {
    throw new AppError(409, 'CONFLICT', 'Solo se reenvían documentos rechazados o sin enviar.');
  }
  const sale = await SaleModel.findById(document.saleId);
  if (sale === null) throw new AppError(404, 'NOT_FOUND', 'Venta no encontrada');
  if (document.kind === 'INVOICE' && sale.status === 'VOIDED' && document.status === 'REJECTED') {
    throw new AppError(409, 'CONFLICT', 'La venta está anulada: esta factura ya no se envía.');
  }

  const settings = await getSettings();
  const taxes = new Map(
    (
      await ProductModel.find({ _id: trusted({ $in: sale.lines.map((line) => line.productId) }) })
    ).map((product) => [product.id, product.tax ?? null] as const),
  );
  const rebuilt = buildDraft(document.kind, sale, taxes, settings, document.draft.observation);
  document.draft = { ...rebuilt, issuedAt: document.draft.issuedAt };
  document.provider = settings.einvoiceProvider;
  document.environment = providerEnvironment(settings.einvoiceProvider);
  document.status = 'PENDING';
  document.attempts = 0;
  document.nextAttemptAt = new Date();
  document.lastError = null;
  await document.save();
  await syncSale(document);

  await recordAudit(
    {
      action: 'EINVOICE_RETRIED',
      actor: toAuditActor(ctx.actor),
      entity: { type: 'SALE', id: sale.id, label: `Venta #${String(document.saleNumber)}` },
      metadata: { kind: document.kind },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toDocumentDto(document);
}
