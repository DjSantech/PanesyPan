import {
  BUSINESS_TIME_ZONE,
  businessDateRangeUtc,
  PAYMENT_METHODS,
  toBusinessDate,
  type DashboardSummary,
  type PaymentMethod,
} from '@panesypan/shared';
import { trusted, type Types } from 'mongoose';
import { CashMovementModel } from '../cash/cash-movement.model';
import { CashShiftModel } from '../cash/cash-shift.model';
import { summarizeShift } from '../cash/cash.service';
import { listInventory } from '../inventory/inventory.service';
import { SaleModel } from '../sales/sale.model';

const TOP_PRODUCTS = 5;
const LOW_STOCK_LIST = 10;

interface TotalsRow {
  count: number;
  total: number;
  discounts: number;
}

/**
 * Resumen del día de negocio para el administrador. Todo es lectura y se recalcula en cada
 * petición: los datos del día son pocos, y así nunca hay una cifra vieja guardada.
 */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  const businessDate = toBusinessDate();
  const { start, end } = businessDateRangeUtc(businessDate);
  const paidToday = { businessDate, status: 'PAID' } as const;

  const [
    totals,
    origins,
    voidedCount,
    hours,
    methods,
    products,
    openShifts,
    movements,
    closed,
    inventory,
  ] = await Promise.all([
    SaleModel.aggregate<TotalsRow>([
      { $match: paidToday },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          total: { $sum: '$total' },
          discounts: { $sum: { $ifNull: ['$discount.amount', 0] } },
        },
      },
    ]),
    SaleModel.aggregate<{ _id: boolean; count: number; total: number }>([
      { $match: paidToday },
      {
        $group: {
          _id: { $ne: [{ $ifNull: ['$webOrderNumber', null] }, null] },
          count: { $sum: 1 },
          total: { $sum: '$total' },
        },
      },
    ]),
    SaleModel.countDocuments({ businessDate, status: 'VOIDED' }),
    SaleModel.aggregate<{ _id: number; count: number; total: number }>([
      { $match: paidToday },
      {
        $group: {
          _id: { $hour: { date: '$paidAt', timezone: BUSINESS_TIME_ZONE } },
          count: { $sum: 1 },
          total: { $sum: '$total' },
        },
      },
    ]),
    SaleModel.aggregate<{ _id: PaymentMethod; amount: number; count: number }>([
      { $match: paidToday },
      { $unwind: '$payments' },
      {
        $group: {
          _id: '$payments.method',
          amount: { $sum: '$payments.amount' },
          count: { $sum: 1 },
        },
      },
    ]),
    SaleModel.aggregate<{ _id: Types.ObjectId; name: string; quantity: number; total: number }>([
      { $match: paidToday },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.productId',
          name: { $last: '$lines.name' },
          quantity: { $sum: '$lines.quantity' },
          total: { $sum: '$lines.total' },
        },
      },
      { $sort: { quantity: -1, total: -1 } },
      { $limit: TOP_PRODUCTS },
    ]),
    CashShiftModel.find({ status: 'OPEN' }).sort({ openedAt: 1 }),
    CashMovementModel.aggregate<{ _id: string; total: number }>([
      { $match: { createdAt: { $gte: start, $lt: end }, status: { $ne: 'VOIDED' } } },
      { $group: { _id: '$type', total: { $sum: '$amount' } } },
    ]),
    CashShiftModel.countDocuments({
      status: 'CLOSED',
      businessDate,
      'closing.difference': trusted({ $ne: 0 }),
    }),
    listInventory({}),
  ]);

  const shiftSummaries = await Promise.all(
    openShifts.map(async (shift) => ({ shift, summary: await summarizeShift(shift) })),
  );

  const salesTotals = totals[0] ?? { count: 0, total: 0, discounts: 0 };
  const origin = (web: boolean) => {
    const row = origins.find((item) => item._id === web);
    return { count: row?.count ?? 0, total: row?.total ?? 0 };
  };
  const hourMap = new Map(hours.map((row) => [row._id, row]));
  const methodMap = new Map(methods.map((row) => [row._id, row]));
  const movementTotal = (type: string): number =>
    movements.find((row) => row._id === type)?.total ?? 0;
  const lowStock = inventory.items
    .filter((item) => item.isLow)
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, 'es'));

  return {
    businessDate,
    generatedAt: new Date().toISOString(),
    sales: {
      count: salesTotals.count,
      total: salesTotals.total,
      average: salesTotals.count === 0 ? 0 : Math.round(salesTotals.total / salesTotals.count),
      discountsTotal: salesTotals.discounts,
      voidedCount,
    },
    byOrigin: { web: origin(true), local: origin(false) },
    // Las 24 horas siempre presentes: el gráfico no salta de una hora a otra.
    byHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hourMap.get(hour)?.count ?? 0,
      total: hourMap.get(hour)?.total ?? 0,
    })),
    byMethod: PAYMENT_METHODS.flatMap((method) => {
      const row = methodMap.get(method);
      return row === undefined ? [] : [{ method, amount: row.amount, count: row.count }];
    }),
    topProducts: products.map((row) => ({
      productId: row._id.toString(),
      name: row.name,
      quantity: row.quantity,
      total: row.total,
    })),
    cash: {
      openShifts: shiftSummaries.map(({ shift, summary }) => ({
        id: shift.id,
        userName: shift.userName,
        openedAt: shift.openedAt.toISOString(),
        openingAmount: shift.openingAmount,
        salesCount: summary.salesCount,
        salesTotal: summary.salesTotal,
        expensesTotal: summary.expensesTotal,
        withdrawalsTotal: summary.withdrawalsTotal,
        expectedCash: summary.expectedCash,
      })),
      expectedCashTotal: shiftSummaries.reduce((sum, { summary }) => sum + summary.expectedCash, 0),
      expensesTotal: movementTotal('EXPENSE'),
      withdrawalsTotal: movementTotal('WITHDRAWAL'),
      closedWithDifference: closed,
    },
    inventory: {
      trackedCount: inventory.items.length,
      lowStockCount: inventory.lowStockCount,
      lowStock: lowStock.slice(0, LOW_STOCK_LIST).map((item) => ({
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        minStock: item.minStock,
      })),
      producedToday: inventory.items.reduce((sum, item) => sum + item.producedToday, 0),
      wastedToday: inventory.items.reduce((sum, item) => sum + item.wastedToday, 0),
      stockValue: inventory.totalValue ?? 0,
    },
  };
}
