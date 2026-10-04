import { SUPPLIER_DOCUMENT_TYPES, type SupplierDocumentType } from '@panesypan/shared';
import { model, Schema, type HydratedDocument } from 'mongoose';

/** Los proveedores no se borran (los egresos los referencian): se archivan con isActive=false. */
export interface SupplierAttrs {
  name: string;
  slug: string;
  documentType: SupplierDocumentType;
  documentNumber: string;
  phone: string;
  email: string;
  city: string;
  address: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const supplierSchema = new Schema<SupplierAttrs>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true },
    documentType: { type: String, enum: SUPPLIER_DOCUMENT_TYPES, default: '' },
    documentNumber: { type: String, default: '', trim: true, maxlength: 30 },
    phone: { type: String, default: '', trim: true, maxlength: 30 },
    email: { type: String, default: '', trim: true, maxlength: 80 },
    city: { type: String, default: '', trim: true, maxlength: 60 },
    address: { type: String, default: '', trim: true, maxlength: 120 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, strict: 'throw' },
);
supplierSchema.index({ slug: 1 }, { unique: true });
supplierSchema.index({ isActive: 1, name: 1 });

export const SupplierModel = model<SupplierAttrs>('Supplier', supplierSchema);
export type SupplierDocument = HydratedDocument<SupplierAttrs>;
