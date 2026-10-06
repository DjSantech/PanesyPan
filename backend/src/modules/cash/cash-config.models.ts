import { CASH_MOVEMENT_TYPES, type CashMovementType } from '@panesypan/shared';
import { model, Schema, type HydratedDocument } from 'mongoose';

export interface CashConceptAttrs {
  name: string;
  /** Nombre en minúsculas y sin tildes, para no repetir tipos con el mismo nombre. */
  key: string;
  type: CashMovementType;
  /** Nómina: pide elegir a la persona del personal. */
  requiresStaff: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const cashConceptSchema = new Schema<CashConceptAttrs>(
  {
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true },
    type: { type: String, enum: CASH_MOVEMENT_TYPES, required: true },
    requiresStaff: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, strict: 'throw' },
);

cashConceptSchema.index({ type: 1, key: 1 }, { unique: true });

export const CashConceptModel = model<CashConceptAttrs>('CashConcept', cashConceptSchema);
export type CashConceptDocument = HydratedDocument<CashConceptAttrs>;

export interface StaffMemberAttrs {
  name: string;
  /** Cargo (Panadero, Auxiliar…), opcional. */
  position: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const staffMemberSchema = new Schema<StaffMemberAttrs>(
  {
    name: { type: String, required: true, trim: true },
    position: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, strict: 'throw' },
);

export const StaffMemberModel = model<StaffMemberAttrs>('StaffMember', staffMemberSchema);
export type StaffMemberDocument = HydratedDocument<StaffMemberAttrs>;
