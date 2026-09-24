import { CASH_SHIFT_STATUSES, type CashShiftStatus } from '@panesypan/shared';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

export interface CashShiftAttrs {
  userId: Types.ObjectId;
  /** Copia del nombre de la cajera al abrir (para reportes aunque luego lo cambien). */
  userName: string;
  status: CashShiftStatus;
  /** Día de negocio en que se abrió la caja. */
  businessDate: string;
  openingAmount: number;
  openingNote: string;
  openedAt: Date;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const cashShiftSchema = new Schema<CashShiftAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
    status: { type: String, enum: CASH_SHIFT_STATUSES, default: 'OPEN' },
    businessDate: { type: String, required: true },
    openingAmount: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: Number.isSafeInteger, message: 'La base es un entero en pesos' },
    },
    openingNote: { type: String, default: '' },
    openedAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: 'throw' },
);

// Cada cajera tiene como máximo una caja abierta.
cashShiftSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
cashShiftSchema.index({ businessDate: 1, openedAt: -1 });

export const CashShiftModel = model<CashShiftAttrs>('CashShift', cashShiftSchema);
export type CashShiftDocument = HydratedDocument<CashShiftAttrs>;
