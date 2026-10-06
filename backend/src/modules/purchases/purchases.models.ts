import { PURCHASE_PAYMENT_METHODS, type PurchasePaymentMethod } from '@panesypan/shared';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';
import type { PersonRef } from '../sales/sale.model';

// ── Proveedores ────────────────────────────────────────────────────

export interface SupplierAttrs {
  name: string;
  /** Nombre en minúsculas y sin tildes, para no repetir proveedores. */
  key: string;
  phone: string;
  taxId: string;
  notes: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const supplierSchema = new Schema<SupplierAttrs>(
  {
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true },
    phone: { type: String, default: '' },
    taxId: { type: String, default: '' },
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, strict: 'throw' },
);
supplierSchema.index({ key: 1 }, { unique: true });

export const SupplierModel = model<SupplierAttrs>('Supplier', supplierSchema);
export type SupplierDocument = HydratedDocument<SupplierAttrs>;

// ── Compras ────────────────────────────────────────────────────────

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
  },
  { timestamps: true, strict: 'throw' },
);
purchaseSchema.index({ number: 1 }, { unique: true });
purchaseSchema.index({ businessDate: 1, createdAt: -1 });
purchaseSchema.index({ 'supplier.id': 1, businessDate: 1 });

export const PurchaseModel = model<PurchaseAttrs>('Purchase', purchaseSchema);
export type PurchaseDocument = HydratedDocument<PurchaseAttrs>;
