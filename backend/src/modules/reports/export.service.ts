import {
  CASH_MOVEMENT_LABELS,
  PURCHASE_PAYMENT_LABELS,
  EINVOICE_STATUS_LABELS,
  formatTimeCO,
  PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
  SALE_TYPE_LABELS,
  STOCK_MOVEMENT_LABELS,
  WASTE_REASON_LABELS,
  PAYMENT_METHODS,
  type ExportKind,
  type ExportQuery,
  type PerformanceRow,
} from '@panesypan/shared';
import { trusted, type QueryFilter } from 'mongoose';
import { recordAudit } from '../audit/audit.service';
import { CashMovementModel } from '../cash/cash-movement.model';
import { CashShiftModel, type CashShiftAttrs } from '../cash/cash-shift.model';
import { getShiftDetail, summarizeShift } from '../cash/cash.service';
import { ProductModel } from '../catalog/catalog.models';
import { StockMovementModel } from '../inventory/inventory.models';
import { listInventory } from '../inventory/inventory.service';
import { PurchaseModel } from '../purchases/purchases.models';
import { SaleModel, type SaleAttrs } from '../sales/sale.model';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { toCsv, type CsvCell } from './csv';
import { getPerformanceReport } from './performance.service';

/** Tope de filas por archivo: protege la memoria del plan gratis de Render. */
const MAX_ROWS = 50_000;

const FILE_LABELS: Readonly<Record<ExportKind, string>> = {
  sales: 'ventas',
  cash: 'cajas',
  performance: 'desempeno',
  movements: 'movimientos-caja',
  incomes: 'ingresos',
  expenses: 'gastos-por-tipo',
  purchases: 'compras',
  inventory: 'inventario',
  stock: 'inventario-valorizado',
  'self-consumption': 'autoconsumo',
};

interface Table {
  headers: string[];
  rows: CsvCell[][];
}

export interface ExportFile {
  filename: string;
  content: string;
}

/** Normaliza campos opcionales de documentos leídos con lean (pueden no existir). */
const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

const dayRange = ({ from, to }: ExportQuery) => trusted({ $gte: from, $lte: to });

async function salesRows(query: ExportQuery): Promise<Table> {
  const filter: QueryFilter<SaleAttrs> = {
    businessDate: dayRange(query),
    status: trusted({ $in: ['PAID', 'VOIDED'] }),
  };
  const sales = await SaleModel.find(filter).sort({ paidAt: 1 }).limit(MAX_ROWS).lean();
  return {
    headers: [
      'Tiquete',
      'Fecha',
      'Hora',
      'Tipo',
      'Mesa',
      'Estado',
      'Cajera',
      'Unidades',
      'Subtotal',
      'Descuento',
      'Total',
      'Medios de pago',
      'Motivo de anulación',
      'Factura electrónica',
      'Estado de la factura',
      'CUFE',
      'Nota crédito',
      'Cliente',
      'Origen',
      'Pedido web',
    ],
    rows: sales.map((sale) => {
      // Las ventas anteriores a la facturación electrónica no tienen estos campos (lean no
      // aplica valores por defecto).
      const einvoice = orNull(sale.einvoice);
      const customer = orNull(sale.customer);
      const webOrder = orNull(sale.webOrderNumber);
      return [
        sale.number,
        sale.businessDate,
        sale.paidAt === null ? null : formatTimeCO(sale.paidAt),
        SALE_TYPE_LABELS[sale.type],
        sale.tableNumber,
        SALE_STATUS_LABELS[sale.status],
        sale.paidBy?.name ?? null,
        sale.lines.reduce((sum, line) => sum + line.quantity, 0),
        sale.subtotal,
        sale.discount?.amount ?? 0,
        sale.total,
        sale.payments
          .map((payment) => `${PAYMENT_METHOD_LABELS[payment.method]} ${String(payment.amount)}`)
          .join(' + '),
        sale.closure?.reason ?? null,
        einvoice?.number ?? null,
        einvoice === null ? null : EINVOICE_STATUS_LABELS[einvoice.status],
        einvoice?.cufe ?? null,
        einvoice?.creditNote?.number ?? null,
        customer === null ? null : `${customer.name} (${customer.idType} ${customer.idNumber})`,
        webOrder === null ? 'Local' : 'Web',
        webOrder,
      ];
    }),
  };
}

async function cashRows(query: ExportQuery): Promise<Table> {
  const filter: QueryFilter<CashShiftAttrs> = { businessDate: dayRange(query) };
  const shifts = await CashShiftModel.find(filter).sort({ openedAt: 1 }).limit(MAX_ROWS);
  const rows: CsvCell[][] = [];
  for (const shift of shifts) {
    const summary = await summarizeShift(shift);
    rows.push([
      shift.number ?? null,
      shift.businessDate,
      shift.userName,
      formatTimeCO(shift.openedAt),
      shift.closedAt === null ? null : formatTimeCO(shift.closedAt),
      shift.status === 'OPEN' ? 'Abierta' : shift.confirmedAt ? 'Confirmada' : 'Cerrada',
      shift.openingAmount,
      summary.salesCount,
      summary.salesTotal,
      summary.byMethod.find((entry) => entry.method === 'CASH')?.amount ?? 0,
      summary.expensesTotal,
      summary.withdrawalsTotal,
      summary.incomesTotal,
      shift.closing?.expectedCash ?? summary.expectedCash,
      shift.closing?.countedCash ?? null,
      shift.closing?.difference ?? null,
      shift.closing?.note ?? null,
      shift.closing?.leftForNext ?? null,
    ]);
  }
  return {
    headers: [
      'Caja N.º',
      'Fecha',
      'Cajera',
      'Apertura',
      'Cierre',
      'Estado',
      'Base',
      'Ventas',
      'Total vendido',
      'Ventas en efectivo',
      'Egresos',
      'Retiros',
      'Ingresos',
      'Efectivo esperado',
      'Efectivo contado',
      'Diferencia',
      'Nota del arqueo',
      'Base que quedó',
    ],
    rows,
  };
}

async function movementRows(query: ExportQuery): Promise<Table> {
  const shifts = await CashShiftModel.find({ businessDate: dayRange(query) })
    .select('number businessDate')
    .lean();
  const shiftById = new Map(shifts.map((shift) => [shift._id.toString(), shift]));
  const movements = await CashMovementModel.find({
    shiftId: trusted({ $in: shifts.map((shift) => shift._id) }),
  })
    .sort({ createdAt: 1 })
    .limit(MAX_ROWS)
    .lean();
  return {
    headers: [
      'Fecha',
      'Hora',
      'Caja N.º',
      'Clase',
      'Tipo',
      'Persona',
      'Monto',
      'Detalle',
      'Registró',
      'Autorizó',
    ],
    rows: movements.map((movement) => {
      const shift = shiftById.get(movement.shiftId.toString());
      return [
        shift?.businessDate ?? null,
        formatTimeCO(movement.createdAt),
        shift?.number ?? null,
        CASH_MOVEMENT_LABELS[movement.type],
        movement.concept?.name ?? null,
        movement.staff?.name ?? null,
        movement.amount,
        movement.reason,
        movement.createdBy.name,
        movement.approvedBy?.name ?? null,
      ];
    }),
  };
}

async function purchaseRows(query: ExportQuery): Promise<Table> {
  const purchases = await PurchaseModel.find({ businessDate: dayRange(query) })
    .sort({ createdAt: 1 })
    .limit(MAX_ROWS)
    .lean();
  return {
    headers: [
      'Fecha',
      'Compra N.º',
      'Proveedor',
      'Artículo',
      'Cantidad',
      'Costo unitario',
      'Total línea',
      'Total compra',
      'Pago',
      'Referencia',
      'Registró',
    ],
    rows: purchases.flatMap((purchase) =>
      purchase.lines.map((line) => [
        purchase.businessDate,
        purchase.number,
        purchase.supplier.name,
        line.name,
        line.quantity,
        line.unitCost,
        line.total,
        purchase.total,
        PURCHASE_PAYMENT_LABELS[purchase.paymentMethod],
        purchase.reference,
        purchase.createdBy.name,
      ]),
    ),
  };
}

async function inventoryRows(query: ExportQuery): Promise<Table> {
  const movements = await StockMovementModel.find({ businessDate: dayRange(query) })
    .sort({ createdAt: 1 })
    .limit(MAX_ROWS)
    .lean();
  return {
    headers: [
      'Fecha',
      'Hora',
      'Producto',
      'Movimiento',
      'Cantidad',
      'Stock después',
      'Motivo',
      'Nota',
      'Registrado por',
    ],
    rows: movements.map((movement) => [
      movement.businessDate,
      formatTimeCO(movement.createdAt),
      movement.productName,
      STOCK_MOVEMENT_LABELS[movement.type],
      movement.delta,
      movement.quantityAfter,
      movement.reason === null ? null : WASTE_REASON_LABELS[movement.reason],
      movement.note,
      movement.by.name,
    ]),
  };
}

const PERFORMANCE_HEADERS = [
  'Vista',
  'Caja / día',
  'Fecha',
  'Cajera',
  ...PAYMENT_METHODS.map((method) => `Ventas ${PAYMENT_METHOD_LABELS[method]}`),
  'Ventas',
  'Total vendido',
  'Descuentos',
  'Anuladas',
  'Total anulado',
  'Devoluciones',
  'Ventas netas',
  'Costo',
  'Utilidad bruta',
  'Ingresos',
  'Gastos',
  'Retiros',
  'Compras',
  'Autoconsumo',
  'Caja inicial',
  'Caja final',
];

function performanceCells(view: string, row: PerformanceRow): CsvCell[] {
  return [
    view,
    row.label,
    row.businessDate,
    row.userName,
    ...PAYMENT_METHODS.map(
      (method) => row.byMethod.find((entry) => entry.method === method)?.amount ?? 0,
    ),
    row.salesCount,
    row.salesTotal,
    row.discountsTotal,
    row.voidedCount,
    row.voidedTotal,
    row.returnsTotal,
    row.netSales,
    row.costOfSales,
    row.grossProfit,
    row.incomesTotal,
    row.expensesTotal,
    row.withdrawalsTotal,
    row.purchasesTotal,
    row.selfConsumptionValue,
    row.openingAmount,
    row.closingCash,
  ];
}

async function performanceRows(query: ExportQuery): Promise<Table> {
  const report = await getPerformanceReport(query);
  return {
    headers: PERFORMANCE_HEADERS,
    rows: [
      ...report.byShift.map((row) => performanceCells('Por caja', row)),
      ...report.byDay.map((row) => performanceCells('Por día', row)),
    ],
  };
}

async function cashMovementsOf(query: ExportQuery, type: 'INCOME' | 'EXPENSE') {
  const shifts = await CashShiftModel.find({ businessDate: dayRange(query) })
    .select('number businessDate')
    .lean();
  const shiftById = new Map(shifts.map((shift) => [shift._id.toString(), shift]));
  const movements = await CashMovementModel.find({
    shiftId: trusted({ $in: shifts.map((shift) => shift._id) }),
    type,
  })
    .sort({ createdAt: 1 })
    .limit(MAX_ROWS)
    .lean();
  return { movements, shiftById };
}

async function incomeRows(query: ExportQuery): Promise<Table> {
  const { movements, shiftById } = await cashMovementsOf(query, 'INCOME');
  return {
    headers: ['Fecha', 'Hora', 'Caja N.º', 'Tipo', 'Monto', 'Detalle', 'Registró'],
    rows: movements.map((movement) => {
      const shift = shiftById.get(movement.shiftId.toString());
      return [
        shift?.businessDate ?? null,
        formatTimeCO(movement.createdAt),
        shift?.number ?? null,
        movement.concept?.name ?? 'Sin tipo',
        movement.amount,
        movement.reason,
        movement.createdBy.name,
      ];
    }),
  };
}

/** Egresos agrupados por tipo (los pagos de compras van en el reporte de compras). */
async function expenseRows(query: ExportQuery): Promise<Table> {
  const { movements } = await cashMovementsOf(query, 'EXPENSE');
  const purchases = await PurchaseModel.find({
    cashMovementId: trusted({ $in: movements.map((movement) => movement._id) }),
  })
    .select('cashMovementId')
    .lean();
  const fromPurchases = new Set(
    purchases.flatMap((purchase) =>
      purchase.cashMovementId === null ? [] : [purchase.cashMovementId.toString()],
    ),
  );
  const byConcept = new Map<string, { amount: number; count: number }>();
  for (const movement of movements) {
    if (fromPurchases.has(movement._id.toString())) continue;
    const name = movement.concept?.name ?? 'Sin tipo';
    const row = byConcept.get(name) ?? { amount: 0, count: 0 };
    byConcept.set(name, { amount: row.amount + movement.amount, count: row.count + 1 });
  }
  return {
    headers: ['Tipo de gasto', 'Cantidad', 'Total'],
    rows: [...byConcept.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([name, row]) => [name, row.count, row.amount]),
  };
}

/** Inventario de hoy valorizado al costo (no depende del rango de fechas). */
async function stockRows(): Promise<Table> {
  const { items } = await listInventory({});
  return {
    headers: ['Código', 'Producto', 'Categoría', 'Existencia', 'Costo unitario', 'Valor'],
    rows: items.map((item) => [
      item.code,
      item.name,
      item.categoryName,
      item.quantity,
      item.cost,
      item.cost === null ? null : item.cost * item.quantity,
    ]),
  };
}

async function selfConsumptionRows(query: ExportQuery): Promise<Table> {
  const movements = await StockMovementModel.find({
    businessDate: dayRange(query),
    type: 'SELF_CONSUMPTION',
  })
    .sort({ createdAt: 1 })
    .limit(MAX_ROWS)
    .lean();
  const products = await ProductModel.find({
    _id: trusted({ $in: movements.map((movement) => movement.productId) }),
  })
    .select('cost')
    .lean();
  const costOf = new Map(products.map((product) => [product._id.toString(), product.cost]));
  return {
    headers: [
      'Fecha',
      'Hora',
      'Producto',
      'Unidades',
      'Costo unitario',
      'Valor',
      'Nota',
      'Registrado por',
    ],
    rows: movements.map((movement) => {
      const units = Math.abs(movement.delta);
      const cost = costOf.get(movement.productId.toString()) ?? null;
      return [
        movement.businessDate,
        formatTimeCO(movement.createdAt),
        movement.productName,
        units,
        cost,
        cost === null ? null : cost * units,
        movement.note,
        movement.by.name,
      ];
    }),
  };
}

const BUILDERS: Readonly<Record<ExportKind, (query: ExportQuery) => Promise<Table>>> = {
  sales: salesRows,
  cash: cashRows,
  performance: performanceRows,
  movements: movementRows,
  incomes: incomeRows,
  expenses: expenseRows,
  purchases: purchaseRows,
  inventory: inventoryRows,
  stock: stockRows,
  'self-consumption': selfConsumptionRows,
};

/** Arma el CSV de un reporte y deja constancia en la auditoría de quién lo descargó. */
export async function exportReport(
  kind: ExportKind,
  query: ExportQuery,
  ctx: ActorContext,
): Promise<ExportFile> {
  const { headers, rows } = await BUILDERS[kind](query);

  await recordAudit(
    {
      action: 'REPORT_EXPORTED',
      actor: toAuditActor(ctx.actor),
      entity: { type: 'REPORT', id: kind, label: FILE_LABELS[kind] },
      metadata: { from: query.from, to: query.to, rows: rows.length },
      meta: ctx.meta,
    },
    ctx.logger,
  );

  return {
    filename: `panesypan-${FILE_LABELS[kind]}-${query.from}_${query.to}.csv`,
    content: toCsv(headers, rows),
  };
}

/**
 * CSV de una caja: el resumen completo y, debajo, cada venta, movimiento y compra del turno.
 */
export async function exportShift(id: string, ctx: ActorContext): Promise<ExportFile> {
  const { shift, movements, report } = await getShiftDetail(id);
  const title = shift.number === null ? shift.businessDate : String(shift.number);
  const rows: CsvCell[][] = [];
  if (report !== undefined) {
    rows.push(performanceCells('Caja', report.performance), []);
    rows.push(
      ['Ventas'],
      ['Tiquete', 'Hora', 'Estado', 'Medios de pago', 'Descuento', 'Total', 'Costo'],
    );
    for (const sale of report.sales) {
      rows.push([
        sale.number,
        sale.paidAt === null ? null : formatTimeCO(new Date(sale.paidAt)),
        SALE_STATUS_LABELS[sale.status],
        sale.methods.map((method) => PAYMENT_METHOD_LABELS[method]).join(' + '),
        sale.discount,
        sale.total,
        sale.cost,
      ]);
    }
    rows.push([]);
  }
  rows.push(['Movimientos de caja'], ['Hora', 'Clase', 'Tipo', 'Persona', 'Monto', 'Detalle']);
  for (const movement of movements) {
    rows.push([
      formatTimeCO(new Date(movement.createdAt)),
      CASH_MOVEMENT_LABELS[movement.type],
      movement.conceptName,
      movement.staffName,
      movement.amount,
      movement.reason,
    ]);
  }
  if (report !== undefined) {
    rows.push([], ['Compras'], ['Compra N.º', 'Hora', 'Proveedor', 'Total']);
    for (const purchase of report.purchases) {
      rows.push([
        purchase.number,
        formatTimeCO(new Date(purchase.createdAt)),
        purchase.supplierName,
        purchase.total,
      ]);
    }
  }

  await recordAudit(
    {
      action: 'REPORT_EXPORTED',
      actor: toAuditActor(ctx.actor),
      entity: { type: 'REPORT', id: 'cash-shift', label: `caja-${title}` },
      metadata: { shiftId: shift.id, rows: rows.length },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return {
    filename: `panesypan-caja-${title}.csv`,
    // La primera fila del archivo es el encabezado del resumen de la caja.
    content: toCsv(PERFORMANCE_HEADERS, rows),
  };
}
