import { z } from 'zod';
import { PAYMENT_METHODS } from '../constants/payment-methods';
import { PRICE_LIMITS } from '../money/money';
import { businessDateSchema } from './common';

/**
 * Turno de caja: la cajera lo abre con una base en efectivo y todas sus ventas quedan
 * amarradas a él. El cierre con arqueo llega en la Fase 1D.
 */
export const CASH_SHIFT_STATUSES = ['OPEN', 'CLOSED'] as const;
export type CashShiftStatus = (typeof CASH_SHIFT_STATUSES)[number];

export const cashShiftSummarySchema = z.object({
  salesCount: z.int(),
  salesTotal: z.int(),
  discountsTotal: z.int(),
  voidedCount: z.int(),
  byMethod: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amount: z.int(), count: z.int() })),
  /** Base + ventas en efectivo (más adelante: − egresos − retiros). */
  expectedCash: z.int(),
});
export type CashShiftSummary = z.infer<typeof cashShiftSummarySchema>;

export const cashShiftSchema = z.object({
  id: z.string(),
  status: z.enum(CASH_SHIFT_STATUSES),
  userId: z.string(),
  userName: z.string(),
  businessDate: businessDateSchema,
  openingAmount: z.int(),
  openingNote: z.string(),
  openedAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  summary: cashShiftSummarySchema,
});
export type CashShift = z.infer<typeof cashShiftSchema>;

export const currentCashShiftResponseSchema = z.object({ shift: cashShiftSchema.nullable() });
export const cashShiftResponseSchema = z.object({ shift: cashShiftSchema });

export const openCashShiftRequestSchema = z.strictObject({
  openingAmount: z
    .int('La base debe ser un número entero de pesos')
    .min(0, 'La base no puede ser negativa')
    .max(PRICE_LIMITS.max, 'La base es demasiado alta'),
  note: z.string().trim().max(200, 'Máximo 200 caracteres').default(''),
});
export type OpenCashShiftRequest = z.input<typeof openCashShiftRequestSchema>;
