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
  type ExportKind,
  type ExportQuery,
} from '@panesypan/shared';
import { trusted, type QueryFilter } from 'mongoose';
import { recordAudit } from '../audit/audit.service';
import { CashMovementModel } from '../cash/cash-movement.model';
import { CashShiftModel, type CashShiftAttrs } from '../cash/cash-shift.model';
import { summarizeShift } from '../cash/cash.service';
import { StockMovementModel } from '../inventory/inventory.models';
import { PurchaseModel } from '../purchases/purchases.models';
import { SaleModel, type SaleAttrs } from '../sales/sale.model';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { toCsv, type CsvCell } from './csv';

/** Tope de filas por archivo: protege la memoria del plan gratis de Render. */
const MAX_ROWS = 50_000;

const FILE_LABELS: Readonly<Record<ExportKind, string>> = {
  sales: 'ventas',
  cash: 'cajas',
  movements: 'movimientos-caja',
  purchases: 'compras',
  inventory: 'inventario',
};

export interface ExportFile {
  filename: string;
  content: string;
}

/** Normaliza campos opcionales de documentos leídos con lean (pueden no existir). */
const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

const dayRange = ({ from, to }: ExportQuery) => trusted({ $gte: from, $lte: to });

async function salesRows(query: ExportQuery): Promise<{ headers: string[]; rows: CsvCell[][] }> {
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

async function cashRows(query: ExportQuery): Promise<{ headers: string[]; rows: CsvCell[][] }> {
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

async function movementRows(query: ExportQuery): Promise<{ headers: string[]; rows: CsvCell[][] }> {
  const shifts = await CashShiftModel.find({ businessDate: dayRange(query) })
    .select('number businessDate')
    .lean();
  const shiftById = new Map(shifts.map((shift) => [shift._id.toString(), shift]));
  const movements = await CashMovementModel.find({
    shiftId: trusted({ $in: shifts.map((shift) => shift._id) }),
    status: trusted({ $ne: 'VOIDED' }),
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

async function purchaseRows(query: ExportQuery): Promise<{ headers: string[]; rows: CsvCell[][] }> {
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

async function inventoryRows(
  query: ExportQuery,
): Promise<{ headers: string[]; rows: CsvCell[][] }> {
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

/** Arma el CSV de un reporte y deja constancia en la auditoría de quién lo descargó. */
export async function exportReport(
  kind: ExportKind,
  query: ExportQuery,
  ctx: ActorContext,
): Promise<ExportFile> {
  const { headers, rows } =
    kind === 'sales'
      ? await salesRows(query)
      : kind === 'cash'
        ? await cashRows(query)
        : kind === 'movements'
          ? await movementRows(query)
          : kind === 'purchases'
            ? await purchaseRows(query)
            : await inventoryRows(query);

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
