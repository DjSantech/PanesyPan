import {
  CASH_SHIFT_STATUSES,
  type CashShiftStatus,
  type DenominationCount,
} from '@panesypan/shared';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

export interface CashShiftClosingAttrs {
  countedCash: number;
  expectedCash: number;
  difference: number;
  counts: DenominationCount[];
  note: string;
  leftForNext?: number | null;
}

export interface CashShiftAttrs {
  /** Consecutivo de la caja (las abiertas antes de existir no lo tienen). */
  number?: number | null;
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
  /** Arqueo al cerrar (null mientras la caja siga abierta). */
  closing: CashShiftClosingAttrs | null;
  /** Revisión del administrador: una caja confirmada ya no cambia. */
  confirmedAt?: Date | null;
  confirmedBy?: { id: Types.ObjectId; name: string } | null;
  confirmNote?: string;
  /**
   * Contador que sube en cada transacción que depende de que la caja siga abierta (cobrar,
   * anular, egresos, cierre). Al escribir todas el mismo documento, MongoDB detecta el choque,
   * aborta una y la reintenta con los datos frescos.
   */
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const cashShiftSchema = new Schema<CashShiftAttrs>(
  {
    number: { type: Number, default: null },
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
    closing: {
      type: new Schema<CashShiftClosingAttrs>(
        {
          countedCash: { type: Number, required: true, min: 0 },
          expectedCash: { type: Number, required: true },
          difference: { type: Number, required: true },
          counts: {
            type: [
              new Schema(
                {
                  denomination: { type: Number, required: true },
                  quantity: { type: Number, required: true, min: 0 },
                },
                { _id: false },
              ),
            ],
            default: [],
          },
          note: { type: String, default: '' },
          leftForNext: { type: Number, default: null, min: 0 },
        },
        { _id: false },
      ),
      default: null,
    },
    confirmedAt: { type: Date, default: null },
    confirmedBy: {
      type: new Schema(
        {
          id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          name: { type: String, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    confirmNote: { type: String, default: '' },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true, strict: 'throw' },
);

// Cada cajera tiene como máximo una caja abierta.
cashShiftSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
cashShiftSchema.index({ businessDate: 1, openedAt: -1 });
cashShiftSchema.index({ status: 1, closedAt: -1 });

export const CashShiftModel = model<CashShiftAttrs>('CashShift', cashShiftSchema);
export type CashShiftDocument = HydratedDocument<CashShiftAttrs>;
