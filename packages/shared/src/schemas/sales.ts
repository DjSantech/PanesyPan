import { z } from 'zod';
import { PAYMENT_METHODS } from '../constants/payment-methods';
import { PRICE_LIMITS } from '../money/money';
import { DISCOUNT_MODES } from '../sales/sale-math';
import { SETTINGS_LIMITS } from './settings';
import { businessDateSchema, moneySchema, objectIdSchema } from './common';

/**
 * Una venta nace de dos formas:
 * - Mostrador: se arma el pedido en la tablet y se cobra de una vez.
 * - Mesa: se abre una cuenta (OPEN), se le agregan o quitan productos y se cobra al final.
 */
export const SALE_STATUSES = ['OPEN', 'PAID', 'VOIDED', 'CANCELED'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_STATUS_LABELS: Readonly<Record<SaleStatus, string>> = {
  OPEN: 'Cuenta abierta',
  PAID: 'Pagada',
  VOIDED: 'Anulada',
  CANCELED: 'Cancelada',
};

export const SALE_TYPES = ['COUNTER', 'TABLE'] as const;
export type SaleType = (typeof SALE_TYPES)[number];

export const SALE_TYPE_LABELS: Readonly<Record<SaleType, string>> = {
  COUNTER: 'Mostrador',
  TABLE: 'Mesa',
};

export const SALE_LIMITS = {
  maxLines: 100,
  maxQuantity: 999,
  noteMax: 80,
  reasonMin: 3,
  reasonMax: 120,
} as const;

// ── Respuestas ─────────────────────────────────────────────────────

const personSchema = z.object({ id: z.string(), name: z.string() });
export type SalePerson = z.infer<typeof personSchema>;

export const saleLineSchema = z.object({
  id: z.string(),
  productId: z.string(),
  name: z.string(),
  unitPrice: z.int(),
  quantity: z.int(),
  /** Detalle para la cocina o el tiquete (p. ej. la proteína del almuerzo). */
  note: z.string(),
  total: z.int(),
  isLunch: z.boolean(),
});
export type SaleLine = z.infer<typeof saleLineSchema>;

export const salePaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.int(),
  reference: z.string(),
});
export type SalePayment = z.infer<typeof salePaymentSchema>;

export const saleDiscountSchema = z.object({
  mode: z.enum(DISCOUNT_MODES),
  value: z.int(),
  amount: z.int(),
  reason: z.string(),
  /** Administrador que autorizó con su PIN (solo si superaba el tope de la cajera). */
  approvedBy: personSchema.nullable(),
});

/** Anulación de una venta pagada o cancelación de una cuenta de mesa. */
export const saleClosureSchema = z.object({
  at: z.iso.datetime(),
  by: personSchema,
  approvedBy: personSchema.nullable(),
  reason: z.string(),
});

export const saleSchema = z.object({
  id: z.string(),
  /** Consecutivo del tiquete; se asigna al cobrar. */
  number: z.int().nullable(),
  type: z.enum(SALE_TYPES),
  tableNumber: z.int().nullable(),
  status: z.enum(SALE_STATUSES),
  lines: z.array(saleLineSchema),
  subtotal: z.int(),
  discount: saleDiscountSchema.nullable(),
  total: z.int(),
  payments: z.array(salePaymentSchema),
  cashReceived: z.int().nullable(),
  change: z.int(),
  shiftId: z.string().nullable(),
  openedBy: personSchema,
  paidBy: personSchema.nullable(),
  openedAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
  businessDate: businessDateSchema.nullable(),
  closure: saleClosureSchema.nullable(),
  updatedAt: z.iso.datetime(),
});
export type Sale = z.infer<typeof saleSchema>;

export const saleResponseSchema = z.object({ sale: saleSchema });
export const listSalesResponseSchema = z.object({ items: z.array(saleSchema) });

// ── Peticiones ─────────────────────────────────────────────────────

/** PIN de 6 dígitos de un administrador que autoriza la operación en la tablet. */
export const approverPinSchema = z.string().regex(/^\d{6}$/, 'El PIN tiene 6 números');

const reasonSchema = z
  .string()
  .trim()
  .min(SALE_LIMITS.reasonMin, 'Escribe el motivo')
  .max(SALE_LIMITS.reasonMax, `Máximo ${String(SALE_LIMITS.reasonMax)} caracteres`);

export const saleLineInputSchema = z.strictObject({
  productId: objectIdSchema,
  quantity: z.int().min(1).max(SALE_LIMITS.maxQuantity),
  note: z.string().trim().max(SALE_LIMITS.noteMax).default(''),
});
export type SaleLineInput = z.input<typeof saleLineInputSchema>;

/** Agregar un producto a la cuenta de una mesa. */
export const addTabLineRequestSchema = saleLineInputSchema;

export const discountInputSchema = z
  .strictObject({
    mode: z.enum(DISCOUNT_MODES),
    value: z.int('Escribe un número entero').positive('El descuento debe ser mayor que 0'),
    reason: reasonSchema,
  })
  .refine((discount) => discount.mode !== 'PERCENT' || discount.value <= 100, {
    message: 'El porcentaje máximo es 100 %',
    path: ['value'],
  });
export type DiscountInput = z.infer<typeof discountInputSchema>;

export const paymentInputSchema = z.strictObject({
  method: z.enum(PAYMENT_METHODS),
  amount: z.int().positive().max(PRICE_LIMITS.max),
  reference: z.string().trim().max(40).default(''),
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

const checkoutShape = {
  /** Identificador que genera la tablet: si la red falla y se reintenta, no se cobra dos veces. */
  clientRequestId: z.uuid(),
  /** Total que vio la cajera: si el precio cambió mientras cobraba, la API avisa. */
  expectedTotal: moneySchema,
  discount: discountInputSchema.nullable().default(null),
  payments: z.array(paymentInputSchema).min(1).max(PAYMENT_METHODS.length),
  cashReceived: moneySchema.max(PRICE_LIMITS.max).nullable().default(null),
  approverPin: approverPinSchema.optional(),
};

export const counterCheckoutRequestSchema = z.strictObject({
  ...checkoutShape,
  lines: z.array(saleLineInputSchema).min(1, 'El pedido está vacío').max(SALE_LIMITS.maxLines),
});
export type CounterCheckoutRequest = z.input<typeof counterCheckoutRequestSchema>;

export const tabCheckoutRequestSchema = z.strictObject(checkoutShape);
export type TabCheckoutRequest = z.input<typeof tabCheckoutRequestSchema>;

export const tableNumberSchema = z.int().min(1).max(SETTINGS_LIMITS.maxTables);

export const openTabRequestSchema = z.strictObject({ tableNumber: tableNumberSchema });
export type OpenTabRequest = z.infer<typeof openTabRequestSchema>;

export const moveTabRequestSchema = z.strictObject({ tableNumber: tableNumberSchema });

export const updateTabLineRequestSchema = z.strictObject({
  quantity: z.int().min(1).max(SALE_LIMITS.maxQuantity),
});

/** Anular una venta pagada o cancelar una cuenta de mesa. */
export const closeSaleRequestSchema = z.strictObject({
  reason: reasonSchema,
  approverPin: approverPinSchema.optional(),
});
export type CloseSaleRequest = z.infer<typeof closeSaleRequestSchema>;

export const listSalesQuerySchema = z.strictObject({
  date: businessDateSchema.optional(),
  shiftId: objectIdSchema.optional(),
  status: z.enum(SALE_STATUSES).optional(),
});
export type ListSalesQuery = z.infer<typeof listSalesQuerySchema>;
