import { z } from 'zod';
import { businessDateSchema, objectIdSchema } from './common';

// ── Tipos de movimiento ────────────────────────────────────────────

/**
 * PRODUCTION y ADJUSTMENT los registra el personal; SALE y SALE_VOID los genera el POS al
 * cobrar o anular una venta de un producto con inventario.
 */
export const STOCK_MOVEMENT_TYPES = [
  'PRODUCTION',
  'WASTE',
  'ADJUSTMENT',
  'SALE',
  'SALE_VOID',
  'PURCHASE',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_LABELS: Readonly<Record<StockMovementType, string>> = {
  PRODUCTION: 'Producción',
  WASTE: 'Merma',
  ADJUSTMENT: 'Ajuste',
  SALE: 'Venta',
  SALE_VOID: 'Venta anulada',
  PURCHASE: 'Compra a proveedor',
};

export const WASTE_REASONS = ['EXPIRED', 'DAMAGED', 'BURNED', 'RETURNED', 'OTHER'] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

export const WASTE_REASON_LABELS: Readonly<Record<WasteReason, string>> = {
  EXPIRED: 'Vencido o pasado de día',
  DAMAGED: 'Dañado o caído',
  BURNED: 'Quemado',
  RETURNED: 'Devuelto por el cliente',
  OTHER: 'Otro motivo',
};

export const STOCK_LIMITS = { maxQuantity: 10_000 } as const;

// ── Inventario ─────────────────────────────────────────────────────

/** Unidades enteras: el pan no se fracciona en el inventario. */
const unitsSchema = z
  .int('La cantidad debe ser un número entero')
  .min(1, 'La cantidad debe ser al menos 1')
  .max(STOCK_LIMITS.maxQuantity, 'La cantidad es demasiado alta');

const noteSchema = z.string().trim().max(200, 'La nota debe tener máximo 200 caracteres');

export const inventoryItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  categoryName: z.string(),
  quantity: z.int().nonnegative(),
  /** Costo unitario del producto (null sin costo o si quien consulta no puede verlo). */
  cost: z.int().nullable(),
  /** 0 = sin alerta. */
  minStock: z.int().nonnegative(),
  /** Hay un mínimo definido y el stock llegó a él o quedó por debajo. */
  isLow: z.boolean(),
  /** Ya se produjo hoy (unidades). */
  producedToday: z.int().nonnegative(),
  /** Mermas de hoy (unidades). */
  wastedToday: z.int().nonnegative(),
});
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export const listInventoryQuerySchema = z.strictObject({
  lowStock: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(60).optional(),
});
export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;

export const listInventoryResponseSchema = z.object({
  items: z.array(inventoryItemSchema),
  lowStockCount: z.int().nonnegative(),
  /** Inventario valorizado: Σ stock × costo de lo que tiene costo (null para la cajera). */
  totalValue: z.int().nullable(),
  /** Productos con stock que todavía no tienen costo (no suman al valor). */
  withoutCost: z.int().nonnegative(),
});
export type ListInventoryResponse = z.infer<typeof listInventoryResponseSchema>;

export const inventoryItemResponseSchema = z.object({ item: inventoryItemSchema });

export const registerProductionRequestSchema = z.strictObject({
  productId: objectIdSchema,
  quantity: unitsSchema,
  note: noteSchema.default(''),
});
export type RegisterProductionRequest = z.input<typeof registerProductionRequestSchema>;

export const registerWasteRequestSchema = z.strictObject({
  productId: objectIdSchema,
  quantity: unitsSchema,
  reason: z.enum(WASTE_REASONS),
  note: noteSchema.default(''),
});
export type RegisterWasteRequest = z.input<typeof registerWasteRequestSchema>;

/** Deja el stock en una cantidad contada (conteo físico). La nota es obligatoria. */
export const adjustStockRequestSchema = z.strictObject({
  productId: objectIdSchema,
  newQuantity: z
    .int('La cantidad debe ser un número entero')
    .min(0, 'La cantidad no puede ser negativa')
    .max(STOCK_LIMITS.maxQuantity, 'La cantidad es demasiado alta'),
  note: noteSchema.min(3, 'Explica el motivo del ajuste'),
});
export type AdjustStockRequest = z.infer<typeof adjustStockRequestSchema>;

export const setMinStockRequestSchema = z.strictObject({
  minStock: z.int('El mínimo debe ser un número entero').min(0).max(STOCK_LIMITS.maxQuantity),
});
export type SetMinStockRequest = z.infer<typeof setMinStockRequestSchema>;

// ── Movimientos ────────────────────────────────────────────────────

export const stockMovementSchema = z.object({
  id: z.string(),
  productId: z.string(),
  productName: z.string(),
  type: z.enum(STOCK_MOVEMENT_TYPES),
  /** Con signo: positivo entra, negativo sale. */
  delta: z.int(),
  quantityAfter: z.int(),
  reason: z.enum(WASTE_REASONS).nullable(),
  note: z.string(),
  businessDate: businessDateSchema,
  by: z.object({ id: z.string(), name: z.string() }),
  createdAt: z.iso.datetime(),
});
export type StockMovement = z.infer<typeof stockMovementSchema>;

export const listMovementsQuerySchema = z.strictObject({
  date: businessDateSchema.optional(),
  type: z.enum(STOCK_MOVEMENT_TYPES).optional(),
  productId: objectIdSchema.optional(),
});
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;

export const listMovementsResponseSchema = z.object({ items: z.array(stockMovementSchema) });
