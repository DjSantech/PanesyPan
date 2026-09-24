import { z } from 'zod';
import { PAYMENT_METHODS } from '../constants/payment-methods';
import { businessDateSchema, moneySchema } from './common';

/** Evento de Socket.IO: los datos del dashboard cambiaron y hay que volver a pedirlos. */
export const DASHBOARD_CHANGED_EVENT = 'dashboard:changed';

/** Ruta del servidor de Socket.IO (bajo /api para que las reglas de Cloudflare la cubran). */
export const REALTIME_PATH = '/api/realtime';

// ── Dashboard ──────────────────────────────────────────────────────

export const dashboardSalesSchema = z.object({
  count: z.int().nonnegative(),
  total: moneySchema,
  /** Total dividido entre las ventas (0 si no hay). */
  average: moneySchema,
  discountsTotal: moneySchema,
  voidedCount: z.int().nonnegative(),
});

export const dashboardHourSchema = z.object({
  /** Hora del día en Colombia, 0–23. */
  hour: z.int().min(0).max(23),
  count: z.int().nonnegative(),
  total: moneySchema,
});

export const dashboardMethodSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: moneySchema,
  count: z.int().nonnegative(),
});

export const dashboardTopProductSchema = z.object({
  productId: z.string(),
  name: z.string(),
  quantity: z.int().nonnegative(),
  total: moneySchema,
});

export const dashboardShiftSchema = z.object({
  id: z.string(),
  userName: z.string(),
  openedAt: z.iso.datetime(),
  openingAmount: moneySchema,
  salesCount: z.int().nonnegative(),
  salesTotal: moneySchema,
  expensesTotal: moneySchema,
  withdrawalsTotal: moneySchema,
  expectedCash: z.int(),
});

export const dashboardLowStockSchema = z.object({
  productId: z.string(),
  name: z.string(),
  quantity: z.int().nonnegative(),
  minStock: z.int().nonnegative(),
});

export const dashboardSummarySchema = z.object({
  businessDate: businessDateSchema,
  generatedAt: z.iso.datetime(),
  sales: dashboardSalesSchema,
  byHour: z.array(dashboardHourSchema),
  byMethod: z.array(dashboardMethodSchema),
  topProducts: z.array(dashboardTopProductSchema),
  cash: z.object({
    /** Cajas abiertas ahora mismo. */
    openShifts: z.array(dashboardShiftSchema),
    /** Efectivo esperado sumando todas las cajas abiertas. */
    expectedCashTotal: z.int(),
    expensesTotal: moneySchema,
    withdrawalsTotal: moneySchema,
    /** Cajas cerradas hoy con sobrante o faltante. */
    closedWithDifference: z.int().nonnegative(),
  }),
  inventory: z.object({
    trackedCount: z.int().nonnegative(),
    lowStockCount: z.int().nonnegative(),
    lowStock: z.array(dashboardLowStockSchema),
    producedToday: z.int().nonnegative(),
    wastedToday: z.int().nonnegative(),
  }),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

// ── Exportes ───────────────────────────────────────────────────────

export const EXPORT_KINDS = ['sales', 'cash', 'inventory'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_LABELS: Readonly<Record<ExportKind, string>> = {
  sales: 'Ventas',
  cash: 'Cajas y arqueos',
  inventory: 'Movimientos de inventario',
};

/** Máximo de días que abarca un exporte (evita respuestas enormes en el plan gratis). */
export const EXPORT_MAX_DAYS = 92;

export const exportQuerySchema = z
  .strictObject({
    from: businessDateSchema,
    to: businessDateSchema,
  })
  .refine((value) => value.from <= value.to, {
    message: 'La fecha inicial no puede ser posterior a la final',
    path: ['from'],
  })
  .refine(
    (value) =>
      (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000 <
      EXPORT_MAX_DAYS,
    { message: `El rango máximo es de ${String(EXPORT_MAX_DAYS)} días`, path: ['to'] },
  );
export type ExportQuery = z.infer<typeof exportQuerySchema>;
