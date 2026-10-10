import { z } from 'zod';
import { PRICE_LIMITS } from '../money/money';
import { receiptSchema } from './cash';
import { costSchema } from './catalog';
import { businessDateSchema, moneySchema, objectIdSchema } from './common';

/**
 * Compras a proveedores, siempre de contado: con efectivo de la caja abierta (el egreso se
 * registra solo) o por transferencia / banco (no toca la caja). Al guardar, los productos del
 * catálogo suben su stock y quedan con el costo de esta compra (último costo).
 */

export const PURCHASE_PAYMENT_METHODS = ['CASH_DRAWER', 'TRANSFER'] as const;
export type PurchasePaymentMethod = (typeof PURCHASE_PAYMENT_METHODS)[number];

export const PURCHASE_PAYMENT_LABELS: Readonly<Record<PurchasePaymentMethod, string>> = {
  CASH_DRAWER: 'Efectivo de la caja',
  TRANSFER: 'Transferencia o banco',
};

export const PURCHASE_LINES_MAX = 50;

/** ACTIVE = vigente; VOIDED = anulada (se devolvió el stock y, si se pudo, el efectivo). */
export const PURCHASE_STATUSES = ['ACTIVE', 'VOIDED'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PURCHASE_STATUS_LABELS: Readonly<Record<PurchaseStatus, string>> = {
  ACTIVE: 'Vigente',
  VOIDED: 'Anulada',
};

export const purchaseLineSchema = z.object({
  /** null = insumo o artículo que no está en el catálogo (no mueve stock). */
  productId: z.string().nullable(),
  name: z.string(),
  quantity: z.int(),
  unitCost: z.int(),
  total: z.int(),
});
export type PurchaseLine = z.infer<typeof purchaseLineSchema>;

export const purchaseSchema = z.object({
  id: z.string(),
  number: z.int(),
  businessDate: businessDateSchema,
  supplier: z.object({ id: z.string(), name: z.string() }),
  lines: z.array(purchaseLineSchema),
  total: moneySchema,
  paymentMethod: z.enum(PURCHASE_PAYMENT_METHODS),
  /** Número de la transferencia o de la factura del proveedor. */
  reference: z.string(),
  note: z.string(),
  createdBy: z.string(),
  /** Administrador que autorizó sacar el efectivo (si hizo falta). */
  approvedBy: z.string().nullable(),
  status: z.enum(PURCHASE_STATUSES),
  voidedAt: z.iso.datetime().nullable(),
  voidedBy: z.string().nullable(),
  voidReason: z.string(),
  /** Al anular: si el efectivo volvió a la caja (null si no se pagó con la caja). */
  voidCashRefunded: z.boolean().nullable(),
  /** Foto de la factura del proveedor (null si no tiene). */
  receipt: receiptSchema.nullable().default(null),
  createdAt: z.iso.datetime(),
});
export type Purchase = z.infer<typeof purchaseSchema>;

export const purchaseLineInputSchema = z
  .strictObject({
    productId: objectIdSchema.optional(),
    /** Para lo que no está en el catálogo (ej.: "Harina 50 kg"). */
    description: z.string().trim().max(80, 'Máximo 80 caracteres').optional(),
    quantity: z
      .int('La cantidad debe ser un número entero')
      .min(1, 'La cantidad debe ser al menos 1')
      .max(10_000, 'La cantidad es demasiado alta'),
    unitCost: costSchema,
  })
  .refine(
    (line) => line.productId !== undefined || (line.description ?? '').length >= 2,
    'Elige un producto o escribe qué se compró',
  );
export type PurchaseLineInput = z.infer<typeof purchaseLineInputSchema>;

export const createPurchaseRequestSchema = z
  .strictObject({
    supplierId: objectIdSchema,
    lines: z
      .array(purchaseLineInputSchema)
      .min(1, 'Agrega al menos un artículo')
      .max(PURCHASE_LINES_MAX, `Máximo ${String(PURCHASE_LINES_MAX)} artículos por compra`),
    paymentMethod: z.enum(PURCHASE_PAYMENT_METHODS),
    reference: z.string().trim().max(60, 'Máximo 60 caracteres').default(''),
    note: z.string().trim().max(200, 'Máximo 200 caracteres').default(''),
    /** PIN de un administrador: si la cajera saca de la caja más del tope de egresos. */
    approverPin: z.string().optional(),
  })
  .refine(
    (purchase) =>
      purchase.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0) <=
      PRICE_LIMITS.max,
    { message: 'El total de la compra es demasiado alto', path: ['lines'] },
  );
export type CreatePurchaseRequest = z.input<typeof createPurchaseRequestSchema>;

export const listPurchasesQuerySchema = z
  .strictObject({
    from: businessDateSchema,
    to: businessDateSchema,
    supplierId: objectIdSchema.optional(),
  })
  .refine((value) => value.from <= value.to, {
    message: 'La fecha inicial no puede ser posterior a la final',
    path: ['from'],
  });
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;

export const listPurchasesResponseSchema = z.object({
  items: z.array(purchaseSchema),
  total: moneySchema,
});
export const purchaseResponseSchema = z.object({ purchase: purchaseSchema });

export const voidPurchaseRequestSchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(3, 'Escribe el motivo de la anulación')
    .max(200, 'Máximo 200 caracteres'),
  /** PIN de un administrador (si quien anula no lo es). */
  approverPin: z.string().optional(),
});
export type VoidPurchaseRequest = z.input<typeof voidPurchaseRequestSchema>;

// ── Devoluciones a proveedor ───────────────────────────────────────

/**
 * Mercancía que se le devuelve a un proveedor: baja el stock y el proveedor reintegra el valor
 * en efectivo (entra a la caja abierta como un ingreso) o como saldo a favor / transferencia
 * (no toca la caja).
 */
export const SUPPLIER_REFUND_METHODS = ['CASH_DRAWER', 'CREDIT'] as const;
export type SupplierRefundMethod = (typeof SUPPLIER_REFUND_METHODS)[number];

export const SUPPLIER_REFUND_LABELS: Readonly<Record<SupplierRefundMethod, string>> = {
  CASH_DRAWER: 'Efectivo a la caja',
  CREDIT: 'Saldo a favor o transferencia',
};

export const supplierReturnLineSchema = z.object({
  productId: z.string(),
  name: z.string(),
  quantity: z.int(),
  unitCost: z.int(),
  total: z.int(),
});

export const supplierReturnSchema = z.object({
  id: z.string(),
  number: z.int(),
  businessDate: businessDateSchema,
  supplier: z.object({ id: z.string(), name: z.string() }),
  lines: z.array(supplierReturnLineSchema),
  total: moneySchema,
  refundMethod: z.enum(SUPPLIER_REFUND_METHODS),
  note: z.string(),
  createdBy: z.string(),
  createdAt: z.iso.datetime(),
});
export type SupplierReturn = z.infer<typeof supplierReturnSchema>;

export const supplierReturnLineInputSchema = z.strictObject({
  productId: objectIdSchema,
  quantity: z
    .int('La cantidad debe ser un número entero')
    .min(1, 'La cantidad debe ser al menos 1')
    .max(10_000, 'La cantidad es demasiado alta'),
  unitCost: costSchema,
});

export const createSupplierReturnRequestSchema = z
  .strictObject({
    supplierId: objectIdSchema,
    lines: z
      .array(supplierReturnLineInputSchema)
      .min(1, 'Agrega al menos un producto')
      .max(PURCHASE_LINES_MAX, `Máximo ${String(PURCHASE_LINES_MAX)} productos por devolución`),
    refundMethod: z.enum(SUPPLIER_REFUND_METHODS),
    note: z.string().trim().max(200, 'Máximo 200 caracteres').default(''),
  })
  .refine((value) => purchaseTotalOf(value.lines) <= PRICE_LIMITS.max, {
    message: 'El total de la devolución es demasiado alto',
    path: ['lines'],
  });
export type CreateSupplierReturnRequest = z.input<typeof createSupplierReturnRequestSchema>;

export const listSupplierReturnsResponseSchema = z.object({
  items: z.array(supplierReturnSchema),
  total: moneySchema,
});
export const supplierReturnResponseSchema = z.object({ supplierReturn: supplierReturnSchema });

/** Total de las líneas de una compra (cantidad × costo unitario). */
export function purchaseTotalOf(lines: readonly { quantity: number; unitCost: number }[]): number {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
}

// ── Pedido sugerido ────────────────────────────────────────────────

/**
 * Lo que conviene pedirle a cada proveedor: productos con stock mínimo que llegaron a él o
 * quedaron por debajo, agrupados por su proveedor principal. Se sugiere pedir hasta el doble
 * del mínimo.
 */
export const orderSuggestionSchema = z.object({
  supplier: z.object({ id: z.string(), name: z.string(), phone: z.string() }).nullable(),
  items: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      quantity: z.int(),
      minStock: z.int(),
      suggested: z.int(),
      /** Último costo (para estimar cuánto se va a pagar). */
      cost: z.int().nullable(),
    }),
  ),
});
export type OrderSuggestion = z.infer<typeof orderSuggestionSchema>;

export const orderSuggestionsResponseSchema = z.object({ groups: z.array(orderSuggestionSchema) });

/** Cuánto pedir para quedar en el doble del mínimo. */
export function suggestedOrderQuantity(quantity: number, minStock: number): number {
  return Math.max(minStock * 2 - quantity, 0);
}
