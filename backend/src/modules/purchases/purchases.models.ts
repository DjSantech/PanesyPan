import {
  PURCHASE_PAYMENT_METHODS,
  PURCHASE_STATUSES,
  SUPPLIER_REFUND_METHODS,
  type PurchasePaymentMethod,
  type PurchaseStatus,
  type SupplierRefundMethod,
} from '@panesypan/shared';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';
import type { PersonRef } from '../sales/sale.model';

export interface PurchaseLineAttrs {
  productId: Types.ObjectId | null;
  name: string;
  quantity: number;
  unitCost: number;
  total: number;
}

export interface PurchaseAttrs {
  number: number;
  businessDate: string;
  supplier: { id: Types.ObjectId; name: string };
  lines: PurchaseLineAttrs[];
  total: number;
  paymentMethod: PurchasePaymentMethod;
  /** Caja de la que salió el efectivo y el egreso que se registró en ella. */
  shiftId: Types.ObjectId | null;
  cashMovementId: Types.ObjectId | null;
  reference: string;
  note: string;
  createdBy: PersonRef;
  approvedBy: PersonRef | null;
  /** Opcionales: las compras guardadas antes de poder anular no los tienen (= vigente). */
  status?: PurchaseStatus;
  voidedAt?: Date | null;
  voidedBy?: PersonRef | null;
  voidReason?: string;
  /** Ingreso (reintegro) que devolvió el efectivo a la caja al anular, si aún estaba abierta. */
  voidCashMovementId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const refSchema = new Schema<{ id: Types.ObjectId; name: string }>(
  {
    id: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
  },
  { _id: false },
);

const purchaseSchema = new Schema<PurchaseAttrs>(
  {
    number: { type: Number, required: true },
    businessDate: { type: String, required: true },
    supplier: { type: refSchema, required: true },
    lines: {
      type: [
        new Schema<PurchaseLineAttrs>(
          {
            productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
            name: { type: String, required: true },
            quantity: { type: Number, required: true, min: 1 },
            unitCost: { type: Number, required: true, min: 0 },
            total: { type: Number, required: true, min: 0 },
          },
          { _id: false },
        ),
      ],
      required: true,
    },
    total: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: PURCHASE_PAYMENT_METHODS, required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'CashShift', default: null },
    cashMovementId: { type: Schema.Types.ObjectId, ref: 'CashMovement', default: null },
    reference: { type: String, default: '' },
    note: { type: String, default: '' },
    createdBy: { type: refSchema, required: true },
    approvedBy: { type: refSchema, default: null },
    status: { type: String, enum: PURCHASE_STATUSES, default: 'ACTIVE' },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: refSchema, default: null },
    voidReason: { type: String, default: '' },
    voidCashMovementId: { type: Schema.Types.ObjectId, ref: 'CashMovement', default: null },
  },
  { timestamps: true, strict: 'throw' },
);
purchaseSchema.index({ number: 1 }, { unique: true });
purchaseSchema.index({ businessDate: 1, createdAt: -1 });
purchaseSchema.index({ 'supplier.id': 1, businessDate: 1 });

export const PurchaseModel = model<PurchaseAttrs>('Purchase', purchaseSchema);
export type PurchaseDocument = HydratedDocument<PurchaseAttrs>;

// ── Devoluciones a proveedor ───────────────────────────────────────

export interface SupplierReturnLineAttrs {
  productId: Types.ObjectId;
  name: string;
  quantity: number;
  unitCost: number;
  total: number;
}

export interface SupplierReturnAttrs {
  number: number;
  businessDate: string;
  supplier: { id: Types.ObjectId; name: string };
  lines: SupplierReturnLineAttrs[];
  total: number;
  refundMethod: SupplierRefundMethod;
  /** Caja a la que entró el efectivo y el ingreso (reintegro) que se registró en ella. */
  shiftId: Types.ObjectId | null;
  cashMovementId: Types.ObjectId | null;
  note: string;
  createdBy: PersonRef;
  createdAt: Date;
  updatedAt: Date;
}

const supplierReturnSchema = new Schema<SupplierReturnAttrs>(
  {
    number: { type: Number, required: true },
    businessDate: { type: String, required: true },
    supplier: { type: refSchema, required: true },
    lines: {
      type: [
        new Schema<SupplierReturnLineAttrs>(
          {
            productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
            name: { type: String, required: true },
            quantity: { type: Number, required: true, min: 1 },
            unitCost: { type: Number, required: true, min: 0 },
            total: { type: Number, required: true, min: 0 },
          },
          { _id: false },
        ),
      ],
      required: true,
    },
    total: { type: Number, required: true, min: 0 },
    refundMethod: { type: String, enum: SUPPLIER_REFUND_METHODS, required: true },
    shiftId: { type: Schema.Types.ObjectId, ref: 'CashShift', default: null },
    cashMovementId: { type: Schema.Types.ObjectId, ref: 'CashMovement', default: null },
    note: { type: String, default: '' },
    createdBy: { type: refSchema, required: true },
  },
  { timestamps: true, strict: 'throw' },
);
supplierReturnSchema.index({ number: 1 }, { unique: true });
supplierReturnSchema.index({ businessDate: 1, createdAt: -1 });
supplierReturnSchema.index({ 'supplier.id': 1, businessDate: 1 });

export const SupplierReturnModel = model<SupplierReturnAttrs>(
  'SupplierReturn',
  supplierReturnSchema,
);
export type SupplierReturnDocument = HydratedDocument<SupplierReturnAttrs>;
