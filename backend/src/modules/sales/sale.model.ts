import {
  BUYER_ID_TYPES,
  DISCOUNT_MODES,
  EINVOICE_ENVIRONMENTS,
  EINVOICE_STATUSES,
  PAYMENT_METHODS,
  SALE_STATUSES,
  SALE_TYPES,
  type BuyerIdType,
  type DiscountMode,
  type EInvoiceEnvironment,
  type EInvoiceStatus,
  type PaymentMethod,
  type SaleStatus,
  type SaleType,
} from '@panesypan/shared';
import { model, Schema, type ClientSession, type HydratedDocument, Types } from 'mongoose';

export interface PersonRef {
  id: Types.ObjectId;
  name: string;
}

export interface SaleLineAttrs {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  /** Copia del nombre y del precio al momento de vender: cambiarlos después no altera la venta. */
  name: string;
  unitPrice: number;
  quantity: number;
  note: string;
  total: number;
  isLunch: boolean;
  /** Día del menú del que se descontó la porción (solo almuerzos). */
  menuDate: string | null;
  /** Proteína, principio y sopa elegidos (solo almuerzos con elección). */
  lunch: { protein: string; principle: string; soup: string | null; drink: string | null } | null;
}

/** Cliente que pidió la factura a su nombre. */
export interface SaleCustomerAttrs {
  idType: BuyerIdType;
  idNumber: string;
  checkDigit: number | null;
  name: string;
  email: string;
}

/** Copia del estado de la factura electrónica, para mostrarla con la venta sin otra consulta. */
export interface SaleEInvoiceAttrs {
  documentId: Types.ObjectId;
  status: EInvoiceStatus;
  environment: EInvoiceEnvironment;
  number: string | null;
  cufe: string | null;
  qrData: string | null;
  publicUrl: string | null;
  validatedAt: Date | null;
  message: string | null;
  creditNote: { documentId: Types.ObjectId; status: EInvoiceStatus; number: string | null } | null;
}

export interface SaleAttrs {
  number: number | null;
  type: SaleType;
  tableNumber: number | null;
  status: SaleStatus;
  lines: SaleLineAttrs[];
  subtotal: number;
  discount: {
    mode: DiscountMode;
    value: number;
    amount: number;
    reason: string;
    approvedBy: PersonRef | null;
  } | null;
  total: number;
  payments: { method: PaymentMethod; amount: number; reference: string }[];
  cashReceived: number | null;
  change: number;
  shiftId: Types.ObjectId | null;
  openedBy: PersonRef;
  paidBy: PersonRef | null;
  openedAt: Date;
  paidAt: Date | null;
  businessDate: string | null;
  closure: { at: Date; by: PersonRef; approvedBy: PersonRef | null; reason: string } | null;
  clientRequestId: string | null;
  customer: SaleCustomerAttrs | null;
  einvoice: SaleEInvoiceAttrs | null;
  /** Pedido web que originó la venta (null = venta en el local). */
  webOrderNumber: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const money = {
  type: Number,
  required: true,
  min: 0,
  validate: { validator: Number.isSafeInteger, message: 'Los montos son enteros en pesos' },
};

const personSchema = new Schema<PersonRef>(
  {
    id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
  },
  { _id: false },
);

const lineSchema = new Schema<SaleLineAttrs>({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  name: { type: String, required: true },
  unitPrice: money,
  quantity: { type: Number, required: true, min: 1 },
  note: { type: String, default: '' },
  total: money,
  isLunch: { type: Boolean, default: false },
  menuDate: { type: String, default: null },
  lunch: {
    type: new Schema(
      {
        protein: { type: String, required: true },
        principle: { type: String, required: true },
        soup: { type: String, default: null },
        drink: { type: String, default: null },
      },
      { _id: false },
    ),
    default: null,
  },
});

const saleSchema = new Schema<SaleAttrs>(
  {
    number: { type: Number, default: null },
    type: { type: String, enum: SALE_TYPES, required: true },
    tableNumber: { type: Number, default: null },
    status: { type: String, enum: SALE_STATUSES, required: true },
    lines: { type: [lineSchema], default: [] },
    subtotal: money,
    discount: {
      type: new Schema(
        {
          mode: { type: String, enum: DISCOUNT_MODES, required: true },
          value: { type: Number, required: true },
          amount: money,
          reason: { type: String, required: true },
          approvedBy: { type: personSchema, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
    total: money,
    payments: {
      type: [
        new Schema(
          {
            method: { type: String, enum: PAYMENT_METHODS, required: true },
            amount: money,
            reference: { type: String, default: '' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    cashReceived: { type: Number, default: null },
    change: { ...money, default: 0 },
    shiftId: { type: Schema.Types.ObjectId, ref: 'CashShift', default: null },
    openedBy: { type: personSchema, required: true },
    paidBy: { type: personSchema, default: null },
    openedAt: { type: Date, required: true },
    paidAt: { type: Date, default: null },
    businessDate: { type: String, default: null },
    closure: {
      type: new Schema(
        {
          at: { type: Date, required: true },
          by: { type: personSchema, required: true },
          approvedBy: { type: personSchema, default: null },
          reason: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    clientRequestId: { type: String, default: null },
    customer: {
      type: new Schema<SaleCustomerAttrs>(
        {
          idType: { type: String, enum: BUYER_ID_TYPES, required: true },
          idNumber: { type: String, required: true },
          checkDigit: { type: Number, default: null },
          name: { type: String, required: true },
          email: { type: String, default: '' },
        },
        { _id: false },
      ),
      default: null,
    },
    webOrderNumber: { type: Number, default: null },
    einvoice: {
      type: new Schema<SaleEInvoiceAttrs>(
        {
          documentId: { type: Schema.Types.ObjectId, ref: 'ElectronicDocument', required: true },
          status: { type: String, enum: EINVOICE_STATUSES, required: true },
          environment: { type: String, enum: EINVOICE_ENVIRONMENTS, required: true },
          number: { type: String, default: null },
          cufe: { type: String, default: null },
          qrData: { type: String, default: null },
          publicUrl: { type: String, default: null },
          validatedAt: { type: Date, default: null },
          message: { type: String, default: null },
          creditNote: {
            type: new Schema(
              {
                documentId: { type: Schema.Types.ObjectId, required: true },
                status: { type: String, enum: EINVOICE_STATUSES, required: true },
                number: { type: String, default: null },
              },
              { _id: false },
            ),
            default: null,
          },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true, strict: 'throw' },
);

// Consecutivo de tiquete único (solo las ventas cobradas tienen número).
saleSchema.index(
  { number: 1 },
  { unique: true, partialFilterExpression: { number: { $type: 'number' } } },
);
// Una sola cuenta abierta por mesa, garantizado por la base de datos.
saleSchema.index(
  { tableNumber: 1 },
  { unique: true, partialFilterExpression: { status: 'OPEN', type: 'TABLE' } },
);
// Un reintento del mismo cobro nunca crea una segunda venta.
saleSchema.index(
  { clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } },
);
saleSchema.index({ shiftId: 1, status: 1 });
saleSchema.index({ businessDate: 1, status: 1, paidAt: -1 });
saleSchema.index({ status: 1, type: 1 });

export const SaleModel = model<SaleAttrs>('Sale', saleSchema);
export type SaleDocument = HydratedDocument<SaleAttrs>;

// ── Consecutivos ───────────────────────────────────────────────────

interface SequenceAttrs {
  _id: string;
  value: number;
}

const sequenceSchema = new Schema<SequenceAttrs>(
  { _id: { type: String, required: true }, value: { type: Number, required: true } },
  { strict: 'throw', versionKey: false },
);

export const SequenceModel = model<SequenceAttrs>('Sequence', sequenceSchema);

/** Siguiente número de una secuencia (dentro de la transacción: si se aborta, no se pierde). */
export async function nextSequence(name: string, session: ClientSession): Promise<number> {
  const sequence = await SequenceModel.findOneAndUpdate(
    { _id: name },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: 'after', session },
  );
  return sequence.value;
}

export const newLineId = (): Types.ObjectId => new Types.ObjectId();
