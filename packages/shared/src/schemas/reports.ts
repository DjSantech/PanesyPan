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

export const dashboardOriginSchema = z.object({
  count: z.int().nonnegative(),
  total: moneySchema,
});

/** Ventas pagadas según su origen: pedidos web frente a ventas en el local. */
export const dashboardByOriginSchema = z.object({
  web: dashboardOriginSchema,
  local: dashboardOriginSchema,
});
export type DashboardByOrigin = z.infer<typeof dashboardByOriginSchema>;

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
  byOrigin: dashboardByOriginSchema,
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
    /** Inventario valorizado al costo. */
    stockValue: moneySchema,
  }),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

// ── Exportes ───────────────────────────────────────────────────────

export const EXPORT_KINDS = ['sales', 'cash', 'movements', 'purchases', 'inventory'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_LABELS: Readonly<Record<ExportKind, string>> = {
  sales: 'Ventas',
  cash: 'Cajas y arqueos',
  movements: 'Egresos, retiros e ingresos de caja',
  purchases: 'Compras a proveedores',
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

// ── Reporte del negocio (rango de días) ────────────────────────────

/** Máximo de días del reporte del negocio (un año). */
export const BUSINESS_REPORT_MAX_DAYS = 366;

export const businessReportQuerySchema = z
  .strictObject({ from: businessDateSchema, to: businessDateSchema })
  .refine((value) => value.from <= value.to, {
    message: 'La fecha inicial no puede ser posterior a la final',
    path: ['from'],
  })
  .refine(
    (value) =>
      (Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`)) / 86_400_000 <
      BUSINESS_REPORT_MAX_DAYS,
    { message: 'El rango máximo es de un año', path: ['to'] },
  );
export type BusinessReportQuery = z.infer<typeof businessReportQuerySchema>;

const namedAmountSchema = z.object({ name: z.string(), amount: z.int(), count: z.int() });

/**
 * Cómo le fue al negocio en un rango de días. La utilidad es ESTIMADA: el costo de lo vendido
 * usa el costo actual de cada producto (el que no tiene costo no se descuenta).
 */
export const businessReportSchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  salesCount: z.int(),
  salesTotal: z.int(),
  returnsTotal: z.int(),
  netSales: z.int(),
  /** Costo de lo vendido (unidades vendidas − devueltas, al costo actual). */
  costOfSales: z.int(),
  /** Unidades vendidas de productos sin costo registrado (no suman al costo). */
  unitsWithoutCost: z.int(),
  /** Egresos de caja (sin los que generan las compras de productos, que ya van en el costo). */
  expensesTotal: z.int(),
  /** Insumos comprados a proveedores que no están en el catálogo. */
  suppliesTotal: z.int(),
  /** Mermas y autoconsumo valorizados al costo. */
  wasteValue: z.int(),
  selfConsumptionValue: z.int(),
  /** Ventas netas − costo de lo vendido − egresos − insumos − mermas − autoconsumo. */
  estimatedProfit: z.int(),
  /** Retiros del dueño (no son gasto: no restan a la utilidad). */
  withdrawalsTotal: z.int(),
  incomesTotal: z.int(),
  byDay: z.array(z.object({ date: businessDateSchema, total: z.int(), count: z.int() })),
  byCategory: z.array(z.object({ name: z.string(), quantity: z.int(), total: z.int() })),
  /** Solo los productos que tienen subcategoría: "Bebidas › Gaseosas". */
  bySubcategory: z.array(z.object({ name: z.string(), quantity: z.int(), total: z.int() })),
  byProduct: z.array(
    z.object({
      productId: z.string(),
      name: z.string(),
      categoryName: z.string(),
      quantity: z.int(),
      total: z.int(),
    }),
  ),
  expensesByConcept: z.array(namedAmountSchema),
  payrollByStaff: z.array(namedAmountSchema),
  purchasesBySupplier: z.array(namedAmountSchema),
  lossesByProduct: z.array(
    z.object({
      name: z.string(),
      wasted: z.int(),
      consumed: z.int(),
      value: z.int(),
    }),
  ),
  /** Inventario valorizado hoy (no depende del rango). */
  stockValue: z.int(),
});
export type BusinessReport = z.infer<typeof businessReportSchema>;
