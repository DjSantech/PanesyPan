import { CASH_MOVEMENT_TYPES, type CashMovementType } from '@panesypan/shared';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';
import type { PersonRef } from '../sales/sale.model';

export interface CashMovementAttrs {
  shiftId: Types.ObjectId;
  type: CashMovementType;
  amount: number;
  reason: string;
  createdBy: PersonRef;
  approvedBy: PersonRef | null;
  createdAt: Date;
  updatedAt: Date;
}

const personSchema = new Schema<PersonRef>(
  {
    id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
  },
  { _id: false },
);

const cashMovementSchema = new Schema<CashMovementAttrs>(
  {
    shiftId: { type: Schema.Types.ObjectId, ref: 'CashShift', required: true },
    type: { type: String, enum: CASH_MOVEMENT_TYPES, required: true },
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isSafeInteger, message: 'Los montos son enteros en pesos' },
    },
    reason: { type: String, required: true },
    createdBy: { type: personSchema, required: true },
    approvedBy: { type: personSchema, default: null },
  },
  { timestamps: true, strict: 'throw' },
);

cashMovementSchema.index({ shiftId: 1, createdAt: 1 });

export const CashMovementModel = model<CashMovementAttrs>('CashMovement', cashMovementSchema);
export type CashMovementDocument = HydratedDocument<CashMovementAttrs>;
