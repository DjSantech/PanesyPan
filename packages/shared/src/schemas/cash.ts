import { z } from 'zod';
import { isDenomination } from '../cash/cash-math';
import { PAYMENT_METHODS } from '../constants/payment-methods';
import { PRICE_LIMITS } from '../money/money';
import { removeAccents } from '../text/text';
import { businessDateSchema, objectIdSchema } from './common';
import { performanceRowSchema } from './reports';

/**
 * Turno de caja: la cajera lo abre con una base en efectivo y todas sus ventas quedan
 * amarradas a él. Durante el turno registra egresos y retiros, y al final cierra con el
 * arqueo por denominaciones.
 */
export const CASH_SHIFT_STATUSES = ['OPEN', 'CLOSED'] as const;
export type CashShiftStatus = (typeof CASH_SHIFT_STATUSES)[number];

/**
 * Egreso: gasto pagado con la caja. Retiro: efectivo que se saca para guardarlo o para el dueño.
 * Ingreso: efectivo que entra sin ser una venta (base adicional, cambio, reintegro).
 */
export const CASH_MOVEMENT_TYPES = ['EXPENSE', 'WITHDRAWAL', 'INCOME'] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

export const CASH_MOVEMENT_LABELS: Readonly<Record<CashMovementType, string>> = {
  EXPENSE: 'Egreso',
  WITHDRAWAL: 'Retiro',
  INCOME: 'Ingreso',
};

export const cashShiftSummarySchema = z.object({
  salesCount: z.int(),
  salesTotal: z.int(),
  discountsTotal: z.int(),
  voidedCount: z.int(),
  byMethod: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amount: z.int(), count: z.int() })),
  expensesTotal: z.int(),
  withdrawalsTotal: z.int(),
  incomesTotal: z.int(),
  /** Devoluciones a clientes registradas en esta caja (todas) y las pagadas en efectivo. */
  returnsTotal: z.int(),
  cashRefundsTotal: z.int(),
  /** Base + ventas en efectivo + ingresos − egresos − retiros − devoluciones en efectivo. */
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
  /** Efectivo que se dejó en el cajón como base del siguiente turno (null si no se indicó). */
  leftForNext: z.int().nullable(),
});
export type CashShiftClosing = z.infer<typeof cashShiftClosingSchema>;

export const cashShiftSchema = z.object({
  id: z.string(),
  /** Consecutivo de la caja (null en las abiertas antes de que existiera). */
  number: z.int().nullable(),
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
  /** El administrador revisó el cierre y lo dio por bueno (queda en la auditoría). */
  confirmedAt: z.iso.datetime().nullable(),
  confirmedBy: z.string().nullable(),
  confirmNote: z.string(),
});
export type CashShift = z.infer<typeof cashShiftSchema>;

export const currentCashShiftResponseSchema = z.object({
  shift: cashShiftSchema.nullable(),
  /** Base que dejó el último cierre en el cajón: se propone al abrir. */
  suggestedOpeningAmount: z.int().nullable(),
});
export const cashShiftResponseSchema = z.object({ shift: cashShiftSchema });

// ── Historial de cajas (administrador) ─────────────────────────────

export const listCashShiftsQuerySchema = z
  .strictObject({
    from: businessDateSchema,
    to: businessDateSchema,
    userId: objectIdSchema.optional(),
  })
  .refine((value) => value.from <= value.to, {
    message: 'La fecha inicial no puede ser posterior a la final',
    path: ['from'],
  });
export type ListCashShiftsQuery = z.infer<typeof listCashShiftsQuerySchema>;

export const listCashShiftsResponseSchema = z.object({ items: z.array(cashShiftSchema) });

/** Resumen detallado de una caja: los movimientos y los totales por tipo. */
export const cashShiftDetailSchema = z.object({
  shift: cashShiftSchema,
  movements: z.array(z.lazy(() => cashMovementSchema)),
  byConcept: z.array(
    z.object({
      type: z.enum(CASH_MOVEMENT_TYPES),
      name: z.string(),
      amount: z.int(),
      count: z.int(),
    }),
  ),
  /** Cifras completas y lo que pasó en la caja (opcional: las API anteriores no lo envían). */
  report: z
    .object({
      performance: performanceRowSchema,
      sales: z.array(
        z.object({
          id: z.string(),
          number: z.int().nullable(),
          paidAt: z.iso.datetime().nullable(),
          status: z.enum(['PAID', 'VOIDED']),
          total: z.int(),
          discount: z.int(),
          cost: z.int(),
          methods: z.array(z.enum(PAYMENT_METHODS)),
        }),
      ),
      purchases: z.array(
        z.object({
          id: z.string(),
          number: z.int(),
          supplierName: z.string(),
          total: z.int(),
          createdAt: z.iso.datetime(),
        }),
      ),
    })
    .optional(),
});
export type CashShiftDetail = z.infer<typeof cashShiftDetailSchema>;

export const confirmCashShiftRequestSchema = z.strictObject({
  note: z.string().trim().max(300, 'Máximo 300 caracteres').default(''),
});
export type ConfirmCashShiftRequest = z.input<typeof confirmCashShiftRequestSchema>;

export const openCashShiftRequestSchema = z.strictObject({
  openingAmount: z
    .int('La base debe ser un número entero de pesos')
    .min(0, 'La base no puede ser negativa')
    .max(PRICE_LIMITS.max, 'La base es demasiado alta'),
  note: z.string().trim().max(200, 'Máximo 200 caracteres').default(''),
});
export type OpenCashShiftRequest = z.input<typeof openCashShiftRequestSchema>;

/** Apertura manual del cajón de dinero desde el POS (sin venta): queda en la auditoría. */
export const drawerOpenRequestSchema = z.strictObject({
  reason: z.string().trim().max(200, 'Máximo 200 caracteres').default(''),
});
export type DrawerOpenRequest = z.input<typeof drawerOpenRequestSchema>;

// ── Tipos de movimiento y personal ─────────────────────────────────

/**
 * Tipo de movimiento de caja (Nómina, Compra de insumos, Arriendo…). Lo administra el dueño en
 * Ajustes y sirve para saber en qué se va la plata. Los de nómina piden la persona del personal.
 */
export const cashConceptSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(CASH_MOVEMENT_TYPES),
  requiresStaff: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.int(),
});
export type CashConcept = z.infer<typeof cashConceptSchema>;

const conceptNameSchema = z
  .string()
  .trim()
  .min(2, 'Mínimo 2 caracteres')
  .max(60, 'Máximo 60 caracteres');

export const createCashConceptRequestSchema = z.strictObject({
  name: conceptNameSchema,
  type: z.enum(CASH_MOVEMENT_TYPES),
  requiresStaff: z.boolean().default(false),
});
export type CreateCashConceptRequest = z.input<typeof createCashConceptRequestSchema>;

export const updateCashConceptRequestSchema = z
  .strictObject({
    name: conceptNameSchema.optional(),
    requiresStaff: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios');
export type UpdateCashConceptRequest = z.infer<typeof updateCashConceptRequestSchema>;

/** Los tipos de egreso de pago a proveedor ("Proveedor", "Pago a proveedor"…) piden el proveedor. */
export function isSupplierConcept(name: string): boolean {
  return removeAccents(name).toLowerCase().includes('proveedor');
}

export const listCashConceptsResponseSchema = z.object({ items: z.array(cashConceptSchema) });
export const cashConceptResponseSchema = z.object({ concept: cashConceptSchema });

/** Persona del personal (panadero, auxiliar…): no necesita usuario para entrar al sistema. */
export const staffMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  position: z.string(),
  isActive: z.boolean(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

const staffNameSchema = z
  .string()
  .trim()
  .min(2, 'Mínimo 2 caracteres')
  .max(80, 'Máximo 80 caracteres');
const staffPositionSchema = z.string().trim().max(60, 'Máximo 60 caracteres');

export const createStaffMemberRequestSchema = z.strictObject({
  name: staffNameSchema,
  position: staffPositionSchema.default(''),
});
export type CreateStaffMemberRequest = z.input<typeof createStaffMemberRequestSchema>;

export const updateStaffMemberRequestSchema = z
  .strictObject({
    name: staffNameSchema.optional(),
    position: staffPositionSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios');
export type UpdateStaffMemberRequest = z.infer<typeof updateStaffMemberRequestSchema>;

export const listStaffResponseSchema = z.object({ items: z.array(staffMemberSchema) });
export const staffMemberResponseSchema = z.object({ member: staffMemberSchema });

// ── Egresos, retiros e ingresos ────────────────────────────────────

/** Anulado: queda el registro pero deja de contar en la caja y en los reportes. */
export const CASH_MOVEMENT_STATUSES = ['ACTIVE', 'VOIDED'] as const;
export type CashMovementStatus = (typeof CASH_MOVEMENT_STATUSES)[number];

/** Tipos aceptados para la foto de un comprobante (el servidor revisa el tipo real). */
export const RECEIPT_IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export const RECEIPT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** Foto del comprobante (factura, recibo) de un egreso, ingreso o compra. */
export const receiptSchema = z.object({
  id: z.string(),
  /** Dirección para verla: Cloudinary o la API (con sesión). */
  url: z.string(),
});
export type Receipt = z.infer<typeof receiptSchema>;

export const cashMovementSchema = z.object({
  id: z.string(),
  type: z.enum(CASH_MOVEMENT_TYPES),
  amount: z.int(),
  /** Tipo de movimiento elegido (null en los registrados antes de que existieran los tipos). */
  conceptId: z.string().nullable(),
  conceptName: z.string().nullable(),
  /** Persona del personal a la que se le pagó (nómina). */
  staffId: z.string().nullable(),
  staffName: z.string().nullable(),
  /** Detalle escrito por quien lo registró (puede ir vacío si eligió un tipo). */
  reason: z.string(),
  createdBy: z.string(),
  /** Administrador que lo autorizó (si hizo falta o si lo hizo él mismo). */
  approvedBy: z.string().nullable(),
  /** Proveedor al que se le pagó (solo en egresos); null si no aplica o la API aún no lo envía. */
  supplier: z.string().nullable().default(null),
  /** Foto del comprobante (null si no tiene). */
  receipt: receiptSchema.nullable().default(null),
  status: z.enum(CASH_MOVEMENT_STATUSES).default('ACTIVE'),
  voidReason: z.string().nullable().default(null),
  voidedBy: z.string().nullable().default(null),
  /** Lo registró una compra: se corrige anulando la compra, no aquí. */
  fromPurchase: z.boolean().default(false),
  createdAt: z.iso.datetime(),
});
export type CashMovement = z.infer<typeof cashMovementSchema>;

/**
 * Cómo se muestra un movimiento: "Nómina · Pedro (día)" o "Proveedor · Lácteos (factura 12)";
 * solo el motivo si no tiene tipo.
 */
export function cashMovementLabel(
  movement: Pick<CashMovement, 'conceptName' | 'staffName' | 'reason'> &
    Partial<Pick<CashMovement, 'supplier'>>,
): string {
  const head = [movement.conceptName, movement.staffName, movement.supplier]
    .filter(Boolean)
    .join(' · ');
  if (head === '') return movement.reason;
  return movement.reason === '' ? head : `${head} (${movement.reason})`;
}

export const listCashMovementsResponseSchema = z.object({ items: z.array(cashMovementSchema) });
export const cashMovementResponseSchema = z.object({ movement: cashMovementSchema });

export const createCashMovementRequestSchema = z
  .strictObject({
    type: z.enum(CASH_MOVEMENT_TYPES),
    amount: z
      .int('El monto debe ser un número entero de pesos')
      .min(1, 'El monto debe ser mayor a cero')
      .max(PRICE_LIMITS.max, 'El monto es demasiado alto'),
    /** Tipo de movimiento (Nómina, Arriendo…). Sin tipo, el motivo es obligatorio. */
    conceptId: objectIdSchema.optional(),
    /** Persona del personal: obligatoria si el tipo es de nómina. */
    staffId: objectIdSchema.optional(),
    /** Proveedor al que se le paga (solo egresos). */
    supplierId: objectIdSchema.optional(),
    reason: z.string().trim().max(200, 'Máximo 200 caracteres').default(''),
    /** PIN de un administrador: obligatorio en los retiros y en los egresos sobre el tope. */
    approverPin: z.string().optional(),
  })
  .refine((value) => value.conceptId !== undefined || value.reason.length >= 3, {
    path: ['reason'],
    message: 'Escribe el motivo (mínimo 3 caracteres)',
  });
export type CreateCashMovementRequest = z.input<typeof createCashMovementRequestSchema>;

/** Corregir un movimiento de la caja abierta (siempre con PIN de administrador). */
export const updateCashMovementRequestSchema = z
  .strictObject({
    amount: z
      .int('El monto debe ser un número entero de pesos')
      .min(1, 'El monto debe ser mayor a cero')
      .max(PRICE_LIMITS.max, 'El monto es demasiado alto')
      .optional(),
    /** Tipo de movimiento de la misma clase; null lo quita. */
    conceptId: objectIdSchema.nullable().optional(),
    reason: z.string().trim().max(200, 'Máximo 200 caracteres').optional(),
    approverPin: z.string().optional(),
  })
  .refine(
    (value) =>
      value.amount !== undefined || value.conceptId !== undefined || value.reason !== undefined,
    'No hay cambios',
  );
export type UpdateCashMovementRequest = z.input<typeof updateCashMovementRequestSchema>;

export const voidCashMovementRequestSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(3, 'Escribe el motivo (mínimo 3 caracteres)')
    .max(200, 'Máximo 200 caracteres'),
  approverPin: z.string().optional(),
});
export type VoidCashMovementRequest = z.input<typeof voidCashMovementRequestSchema>;

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
  /** Efectivo que queda en el cajón como base del siguiente turno (no puede pasar de lo contado). */
  leftForNext: z
    .int('La base debe ser un número entero de pesos')
    .min(0, 'La base no puede ser negativa')
    .max(PRICE_LIMITS.max)
    .optional(),
});
export type CloseCashShiftRequest = z.input<typeof closeCashShiftRequestSchema>;
