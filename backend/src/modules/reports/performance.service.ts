import {
  expectedCashOf,
  PAYMENT_METHODS,
  type BusinessReportQuery,
  type CashShiftDetail,
  type PaymentMethod,
  type PerformanceReport,
  type PerformanceRow,
} from '@panesypan/shared';
import { trusted, type Types } from 'mongoose';
import { CashMovementModel } from '../cash/cash-movement.model';
import { CashShiftModel, type CashShiftAttrs } from '../cash/cash-shift.model';
import { ProductModel } from '../catalog/catalog.models';
import { StockMovementModel } from '../inventory/inventory.models';
import { PurchaseModel } from '../purchases/purchases.models';
import { SaleModel } from '../sales/sale.model';

type ShiftLike = Pick<
  CashShiftAttrs,
  'number' | 'userName' | 'businessDate' | 'openingAmount' | 'closing'
> & { _id: Types.ObjectId };

/** Fila en ceros: se va llenando con cada venta, movimiento y compra. */
export function emptyRow(
  key: string,
  label: string,
  businessDate: string,
  userName: string | null,
): PerformanceRow {
  return {
    key,
    label,
    businessDate,
    userName,
    shiftsCount: 0,
    salesCount: 0,
    byMethod: [],
    salesTotal: 0,
    discountsTotal: 0,
    voidedCount: 0,
    voidedTotal: 0,
    returnsTotal: 0,
    netSales: 0,
    costOfSales: 0,
    grossProfit: 0,
    incomesTotal: 0,
    expensesTotal: 0,
    withdrawalsTotal: 0,
    purchasesTotal: 0,
    selfConsumptionValue: null,
    openingAmount: 0,
    closingCash: 0,
  };
}

const NUMERIC_KEYS = [
  'shiftsCount',
  'salesCount',
  'salesTotal',
  'discountsTotal',
  'voidedCount',
  'voidedTotal',
  'returnsTotal',
  'netSales',
  'costOfSales',
  'grossProfit',
  'incomesTotal',
  'expensesTotal',
  'withdrawalsTotal',
  'purchasesTotal',
  'openingAmount',
  'closingCash',
] as const;

/** Suma la fila `from` dentro de `into` (para consolidar cajas por día). */
export function addRow(into: PerformanceRow, from: PerformanceRow): void {
  for (const key of NUMERIC_KEYS) into[key] += from[key];
  const methods = new Map(into.byMethod.map((entry) => [entry.method, entry.amount]));
  for (const entry of from.byMethod) {
    methods.set(entry.method, (methods.get(entry.method) ?? 0) + entry.amount);
  }
  into.byMethod = PAYMENT_METHODS.flatMap((method) => {
    const amount = methods.get(method);
    return amount === undefined ? [] : [{ method, amount }];
  });
}

export const shiftLabel = (shift: Pick<ShiftLike, 'number' | 'businessDate'>): string =>
  shift.number === null || shift.number === undefined
    ? `Caja del ${shift.businessDate}`
    : `Caja N.º ${String(shift.number)}`;

interface ShiftData {
  rows: Map<string, PerformanceRow>;
  sales: Map<string, NonNullable<CashShiftDetail['report']>['sales']>;
  purchases: Map<string, NonNullable<CashShiftDetail['report']>['purchases']>;
}

/**
 * Cifras de un grupo de cajas: ventas por medio de pago, costo, utilidad bruta, movimientos,
 * compras pagadas con la caja y el efectivo final. Las ventas anuladas no suman a nada.
 */
async function computeShifts(shifts: readonly ShiftLike[]): Promise<ShiftData> {
  const ids = shifts.map((shift) => shift._id);
  const [sales, withReturns, movements, purchases, products] = await Promise.all([
    SaleModel.find({ shiftId: trusted({ $in: ids }), status: trusted({ $in: ['PAID', 'VOIDED'] }) })
      .select('number status total discount payments lines returns shiftId paidAt')
      .sort({ paidAt: 1 })
      .lean(),
    SaleModel.find({ 'returns.shiftId': trusted({ $in: ids }) })
      .select('returns')
      .lean(),
    CashMovementModel.find({ shiftId: trusted({ $in: ids }) }).lean(),
    PurchaseModel.find({ shiftId: trusted({ $in: ids }) })
      .sort({ createdAt: 1 })
      .lean(),
    ProductModel.find().select('cost').lean(),
  ]);
  const productCost = new Map(products.map((product) => [product._id.toString(), product.cost]));

  const rows = new Map<string, PerformanceRow>();
  const methods = new Map<string, Map<PaymentMethod, number>>();
  const cashRefunds = new Map<string, number>();
  const saleLists: ShiftData['sales'] = new Map();
  const purchaseLists: ShiftData['purchases'] = new Map();
  for (const shift of shifts) {
    const key = shift._id.toString();
    const row = emptyRow(key, shiftLabel(shift), shift.businessDate, shift.userName);
    row.shiftsCount = 1;
    row.openingAmount = shift.openingAmount;
    rows.set(key, row);
    methods.set(key, new Map());
    saleLists.set(key, []);
    purchaseLists.set(key, []);
  }

  // Devoluciones: cuentan en la caja de la que salió el dinero.
  for (const sale of withReturns) {
    for (const entry of sale.returns) {
      const row = rows.get(entry.shiftId.toString());
      if (row === undefined) continue;
      row.returnsTotal += entry.amount;
      if (entry.refundMethod === 'CASH') {
        cashRefunds.set(row.key, (cashRefunds.get(row.key) ?? 0) + entry.amount);
      }
    }
  }

  for (const sale of sales) {
    if (sale.shiftId === null) continue;
    const key = sale.shiftId.toString();
    const row = rows.get(key);
    if (row === undefined) continue;
    // Costo de lo vendido menos lo devuelto, con el costo guardado al vender (o el actual).
    const returned = new Map<string, number>();
    for (const entry of sale.returns) {
      for (const line of entry.lines) {
        const lineKey = line.lineId.toString();
        returned.set(lineKey, (returned.get(lineKey) ?? 0) + line.quantity);
      }
    }
    let cost = 0;
    for (const line of sale.lines) {
      const unitCost = line.unitCost ?? productCost.get(line.productId.toString()) ?? 0;
      cost += unitCost * (line.quantity - (returned.get(line._id.toString()) ?? 0));
    }
    saleLists.get(key)?.push({
      id: sale._id.toString(),
      number: sale.number,
      paidAt: sale.paidAt?.toISOString() ?? null,
      status: sale.status === 'VOIDED' ? 'VOIDED' : 'PAID',
      total: sale.total,
      discount: sale.discount?.amount ?? 0,
      cost: sale.status === 'VOIDED' ? 0 : cost,
      methods: [...new Set(sale.payments.map((payment) => payment.method))],
    });
    if (sale.status === 'VOIDED') {
      row.voidedCount += 1;
      row.voidedTotal += sale.total;
      continue;
    }
    row.salesCount += 1;
    row.salesTotal += sale.total;
    row.discountsTotal += sale.discount?.amount ?? 0;
    row.costOfSales += cost;
    const byMethod = methods.get(key);
    for (const payment of sale.payments) {
      byMethod?.set(payment.method, (byMethod.get(payment.method) ?? 0) + payment.amount);
    }
  }

  const fromPurchases = new Set(
    purchases.flatMap((purchase) =>
      purchase.cashMovementId === null ? [] : [purchase.cashMovementId.toString()],
    ),
  );
  for (const movement of movements) {
    const row = rows.get(movement.shiftId.toString());
    if (row === undefined) continue;
    if (movement.type === 'INCOME') row.incomesTotal += movement.amount;
    else if (movement.type === 'WITHDRAWAL') row.withdrawalsTotal += movement.amount;
    else if (!fromPurchases.has(movement._id.toString())) row.expensesTotal += movement.amount;
  }
  // El egreso que generó una compra en efectivo ya está en "compras": no se cuenta dos veces,
  // pero sí sale del cajón para el efectivo esperado.
  const purchaseCash = new Map<string, number>();
  for (const purchase of purchases) {
    if (purchase.shiftId === null) continue;
    const key = purchase.shiftId.toString();
    const row = rows.get(key);
    if (row === undefined) continue;
    row.purchasesTotal += purchase.total;
    if (purchase.cashMovementId !== null) {
      const paid = movements.find((movement) => movement._id.equals(purchase.cashMovementId));
      purchaseCash.set(key, (purchaseCash.get(key) ?? 0) + (paid?.amount ?? 0));
    }
    purchaseLists.get(key)?.push({
      id: purchase._id.toString(),
      number: purchase.number,
      supplierName: purchase.supplier.name,
      total: purchase.total,
      createdAt: purchase.createdAt.toISOString(),
    });
  }

  for (const shift of shifts) {
    const key = shift._id.toString();
    const row = rows.get(key);
    const byMethod = methods.get(key);
    if (row === undefined || byMethod === undefined) continue;
    row.byMethod = PAYMENT_METHODS.flatMap((method) => {
      const amount = byMethod.get(method);
      return amount === undefined ? [] : [{ method, amount }];
    });
    row.netSales = row.salesTotal - row.returnsTotal;
    row.grossProfit = row.netSales - row.costOfSales;
    row.closingCash =
      shift.closing?.countedCash ??
      expectedCashOf({
        openingAmount: shift.openingAmount,
        cashSales: byMethod.get('CASH') ?? 0,
        expenses: row.expensesTotal + (purchaseCash.get(key) ?? 0),
        withdrawals: row.withdrawalsTotal,
        incomes: row.incomesTotal,
        refunds: cashRefunds.get(key) ?? 0,
      });
  }
  return { rows, sales: saleLists, purchases: purchaseLists };
}

/** Cifras completas de una caja con sus ventas y compras (para el detalle de caja). */
export async function getShiftReport(shift: ShiftLike): Promise<CashShiftDetail['report']> {
  const data = await computeShifts([shift]);
  const key = shift._id.toString();
  const performance = data.rows.get(key);
  if (performance === undefined) return undefined;
  return {
    performance,
    sales: data.sales.get(key) ?? [],
    purchases: data.purchases.get(key) ?? [],
  };
}

/**
 * Desempeño en un rango: una fila por caja (vista detallada) y una por día (consolidada). El día
 * suma sus cajas y agrega lo que no depende de una caja: todas las compras y el autoconsumo.
 */
export async function getPerformanceReport(query: BusinessReportQuery): Promise<PerformanceReport> {
  const range = trusted({ $gte: query.from, $lte: query.to });
  const [shifts, purchases, consumption, products] = await Promise.all([
    CashShiftModel.find({ businessDate: range })
      .select('number userName businessDate openingAmount closing openedAt')
      .sort({ openedAt: 1 })
      .lean(),
    PurchaseModel.find({ businessDate: range }).select('businessDate total').lean(),
    StockMovementModel.find({ businessDate: range, type: 'SELF_CONSUMPTION' })
      .select('businessDate productId delta')
      .lean(),
    ProductModel.find().select('cost').lean(),
  ]);
  const productCost = new Map(products.map((product) => [product._id.toString(), product.cost]));
  const data = await computeShifts(shifts);
  const byShift = shifts.flatMap((shift) => {
    const row = data.rows.get(shift._id.toString());
    return row === undefined ? [] : [row];
  });

  const days = new Map<string, PerformanceRow>();
  const dayOf = (date: string): PerformanceRow => {
    let row = days.get(date);
    if (row === undefined) {
      row = emptyRow(date, date, date, null);
      row.selfConsumptionValue = 0;
      days.set(date, row);
    }
    return row;
  };
  for (const row of byShift) {
    // Las compras del día se suman aparte (todas, se hayan pagado o no con una caja).
    addRow(dayOf(row.businessDate), { ...row, purchasesTotal: 0 });
  }
  for (const purchase of purchases) dayOf(purchase.businessDate).purchasesTotal += purchase.total;
  for (const movement of consumption) {
    const row = dayOf(movement.businessDate);
    const cost = productCost.get(movement.productId.toString()) ?? 0;
    row.selfConsumptionValue = (row.selfConsumptionValue ?? 0) + Math.abs(movement.delta) * cost;
  }
  return {
    from: query.from,
    to: query.to,
    byShift,
    byDay: [...days.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate)),
  };
}
