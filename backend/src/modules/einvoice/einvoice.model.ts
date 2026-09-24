import {
  EINVOICE_ENVIRONMENTS,
  EINVOICE_KINDS,
  EINVOICE_PROVIDERS,
  EINVOICE_STATUSES,
  type EInvoiceEnvironment,
  type EInvoiceKind,
  type EInvoiceProvider,
  type EInvoiceStatus,
} from '@panesypan/shared';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';
import type { DocumentDraft } from './draft';

export interface EInvoiceResultAttrs {
  number: string;
  cufe: string;
  qrData: string | null;
  publicUrl: string | null;
  validatedAt: Date;
  providerId: string | null;
}

/**
 * Documento electrónico (factura o nota crédito) de una venta. Funciona como una cola:
 * se crea en la misma transacción que la venta y un proceso lo envía al proveedor.
 */
export interface ElectronicDocumentAttrs {
  kind: EInvoiceKind;
  status: EInvoiceStatus;
  provider: EInvoiceProvider;
  environment: EInvoiceEnvironment;
  saleId: Types.ObjectId;
  saleNumber: number;
  referenceCode: string;
  draft: DocumentDraft;
  /** Nota crédito: la factura que anula. */
  invoiceId: Types.ObjectId | null;
  attempts: number;
  nextAttemptAt: Date | null;
  /** Mientras se envía: hasta cuándo lo tiene tomado el proceso (si se cae, otro lo retoma). */
  lockedUntil: Date | null;
  lastError: string | null;
  result: EInvoiceResultAttrs | null;
  createdAt: Date;
  updatedAt: Date;
}

const resultSchema = new Schema<EInvoiceResultAttrs>(
  {
    number: { type: String, required: true },
    cufe: { type: String, required: true },
    qrData: { type: String, default: null },
    publicUrl: { type: String, default: null },
    validatedAt: { type: Date, required: true },
    providerId: { type: String, default: null },
  },
  { _id: false },
);

const electronicDocumentSchema = new Schema<ElectronicDocumentAttrs>(
  {
    kind: { type: String, enum: EINVOICE_KINDS, required: true },
    status: { type: String, enum: EINVOICE_STATUSES, required: true },
    provider: { type: String, enum: EINVOICE_PROVIDERS, required: true },
    environment: { type: String, enum: EINVOICE_ENVIRONMENTS, required: true },
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true },
    saleNumber: { type: Number, required: true },
    referenceCode: { type: String, required: true },
    // El borrador se guarda tal cual se armó: es lo que se envía.
    draft: { type: Schema.Types.Mixed, required: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'ElectronicDocument', default: null },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
    lastError: { type: String, default: null },
    result: { type: resultSchema, default: null },
  },
  { timestamps: true, strict: 'throw' },
);

// Una factura y a lo sumo una nota crédito por venta; el reference_code nunca se repite.
electronicDocumentSchema.index({ saleId: 1, kind: 1 }, { unique: true });
electronicDocumentSchema.index({ referenceCode: 1 }, { unique: true });
electronicDocumentSchema.index({ status: 1, nextAttemptAt: 1 });
electronicDocumentSchema.index({ createdAt: -1 });

export const ElectronicDocumentModel = model<ElectronicDocumentAttrs>(
  'ElectronicDocument',
  electronicDocumentSchema,
);
export type ElectronicDocumentDocument = HydratedDocument<ElectronicDocumentAttrs>;
