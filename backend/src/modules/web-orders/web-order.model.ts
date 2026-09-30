import { WEB_ORDER_STATUSES, type WebOrderStatus } from '@panesypan/shared';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

export interface WebOrderLineAttrs {
  productId: Types.ObjectId;
  /** Copia del nombre y del precio de la BD al momento del pedido. */
  name: string;
  unitPrice: number;
  quantity: number;
  total: number;
  /** Proteína, principio y sopa (solo almuerzos con elección). */
  lunch: { protein: string; principle: string; soup: string | null; drink: string | null } | null;
}

export interface WebOrderStatusChange {
  status: WebOrderStatus;
  at: Date;
  by: { id: Types.ObjectId; name: string } | null;
}

export interface WebOrderAttrs {
  number: number;
  status: WebOrderStatus;
  source: 'WEB';
  customer: {
    name: string;
    phone: string;
    address: string;
    neighborhood: string;
    note: string;
  };
  lines: WebOrderLineAttrs[];
  subtotal: number;
  /** null = "a confirmar por WhatsApp". */
  deliveryFee: number | null;
  total: number;
  statusHistory: WebOrderStatusChange[];
  /** Venta creada al cobrar el pedido. */
  saleId: Types.ObjectId | null;
  /** Motivo de la cancelación. */
  cancelReason: string | null;
  /** UUID que genera la web: los reintentos no duplican el pedido. */
  clientRequestId: string;
  createdAt: Date;
  updatedAt: Date;
}

const lineSchema = new Schema<WebOrderLineAttrs>(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    total: { type: Number, required: true, min: 0 },
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
  },
  { _id: false, strict: 'throw' },
);

const statusChangeSchema = new Schema<WebOrderStatusChange>(
  {
    status: { type: String, enum: WEB_ORDER_STATUSES, required: true },
    at: { type: Date, required: true },
    by: {
      type: new Schema(
        {
          id: { type: Schema.Types.ObjectId, required: true },
          name: { type: String, required: true },
        },
        { _id: false, strict: 'throw' },
      ),
      default: null,
    },
  },
  { _id: false, strict: 'throw' },
);

const webOrderSchema = new Schema<WebOrderAttrs>(
  {
    number: { type: Number, required: true },
    status: { type: String, enum: WEB_ORDER_STATUSES, required: true, default: 'PENDING' },
    source: { type: String, enum: ['WEB'], required: true, default: 'WEB' },
    customer: {
      type: new Schema(
        {
          name: { type: String, required: true },
          phone: { type: String, required: true },
          address: { type: String, required: true },
          neighborhood: { type: String, required: true },
          note: { type: String, default: '' },
        },
        { _id: false, strict: 'throw' },
      ),
      required: true,
    },
    lines: { type: [lineSchema], required: true },
    subtotal: { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, default: null },
    total: { type: Number, required: true, min: 0 },
    statusHistory: { type: [statusChangeSchema], default: [] },
    saleId: { type: Schema.Types.ObjectId, default: null },
    cancelReason: { type: String, default: null },
    clientRequestId: { type: String, required: true },
  },
  { collection: 'weborders', timestamps: true, strict: 'throw' },
);

webOrderSchema.index({ number: 1 }, { unique: true });
webOrderSchema.index({ clientRequestId: 1 }, { unique: true });
webOrderSchema.index({ status: 1, createdAt: -1 });

export const WebOrderModel = model<WebOrderAttrs>('WebOrder', webOrderSchema);
export type WebOrderDocument = HydratedDocument<WebOrderAttrs>;
