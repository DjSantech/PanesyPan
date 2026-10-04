import { z } from 'zod';
import { isDenomination } from '../cash/cash-math';
import { PAYMENT_METHODS } from '../constants/payment-methods';
import { PRICE_LIMITS } from '../money/money';
import { businessDateSchema, objectIdSchema } from './common';

/**
 * Turno de caja: la cajera lo abre con una base en efectivo y todas sus ventas quedan
 * amarradas a él. Durante el turno registra egresos y retiros, y al final cierra con el
 * arqueo por denominaciones.
 */
export const CASH_SHIFT_STATUSES = ['OPEN', 'CLOSED'] as const;
export type CashShiftStatus = (typeof CASH_SHIFT_STATUSES)[number];

/** Egreso: gasto menor pagado con la caja. Retiro: efectivo que se saca para guardarlo. */
export const CASH_MOVEMENT_TYPES = ['EXPENSE', 'WITHDRAWAL'] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

export const CASH_MOVEMENT_LABELS: Readonly<Record<CashMovementType, string>> = {
  EXPENSE: 'Egreso',
  WITHDRAWAL: 'Retiro',
};

export const cashShiftSummarySchema = z.object({
  salesCount: z.int(),
  salesTotal: z.int(),
  discountsTotal: z.int(),
  voidedCount: z.int(),
  byMethod: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amount: z.int(), count: z.int() })),
  expensesTotal: z.int(),
  withdrawalsTotal: z.int(),
  /** Base + ventas en efectivo − egresos − retiros. */
  expectedCash: z.int(),
});
export type CashShiftSummary = z.infer<typeof cashShiftSummarySchema>;

export const denominationCountSchema = z.object({
  denomination: z.number().refine(isDenomination, 'Denominación inválida'),
  quantity: z.int(),
});

export const cashShiftClosingSchema = z.object({
  countedCash: z.int(),
  expectedCash: z.int(),
  /** Positiva = sobrante, negativa = faltante. */
  difference: z.int(),
  counts: z.array(denominationCountSchema),
  note: z.string(),
});
export type CashShiftClosing = z.infer<typeof cashShiftClosingSchema>;

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
  closing: cashShiftClosingSchema.nullable(),
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

// ── Egresos y retiros ──────────────────────────────────────────────

export const cashMovementSchema = z.object({
  id: z.string(),
  type: z.enum(CASH_MOVEMENT_TYPES),
  amount: z.int(),
  reason: z.string(),
  createdBy: z.string(),
  /** Administrador que lo autorizó (si hizo falta o si lo hizo él mismo). */
  approvedBy: z.string().nullable(),
  /** Proveedor al que se le pagó (solo en egresos); null si no aplica o la API aún no lo envía. */
  supplier: z.string().nullable().default(null),
  createdAt: z.iso.datetime(),
});
export type CashMovement = z.infer<typeof cashMovementSchema>;

export const listCashMovementsResponseSchema = z.object({ items: z.array(cashMovementSchema) });
export const cashMovementResponseSchema = z.object({ movement: cashMovementSchema });

export const createCashMovementRequestSchema = z.strictObject({
  type: z.enum(CASH_MOVEMENT_TYPES),
  amount: z
    .int('El monto debe ser un número entero de pesos')
    .min(1, 'El monto debe ser mayor a cero')
    .max(PRICE_LIMITS.max, 'El monto es demasiado alto'),
  reason: z
    .string()
    .trim()
    .min(3, 'Escribe el motivo (mínimo 3 caracteres)')
    .max(200, 'Máximo 200 caracteres'),
  /** Proveedor al que se le paga (solo egresos). */
  supplierId: objectIdSchema.optional(),
  /** PIN de un administrador: obligatorio en los retiros y en los egresos sobre el tope. */
  approverPin: z.string().optional(),
});
export type CreateCashMovementRequest = z.infer<typeof createCashMovementRequestSchema>;

// ── Cierre con arqueo ──────────────────────────────────────────────

export const closeCashShiftRequestSchema = z.strictObject({
  /** Lo contado por denominación (las que no se nombran cuentan cero). */
  counts: z
    .array(
      z.strictObject({
        denomination: z.number().refine(isDenomination, 'Denominación inválida'),
        quantity: z.int('Cuenta unidades enteras').min(0, 'No puede ser negativo').max(100_000),
      }),
    )
    .max(20)
    .refine((counts) => new Set(counts.map((c) => c.denomination)).size === counts.length, {
      message: 'Cada denominación va una sola vez',
    }),
  /** Obligatoria cuando hay sobrante o faltante. */
  note: z.string().trim().max(300, 'Máximo 300 caracteres').default(''),
});
export type CloseCashShiftRequest = z.input<typeof closeCashShiftRequestSchema>;
