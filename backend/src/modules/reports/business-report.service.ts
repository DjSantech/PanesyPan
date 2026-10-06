import type { BusinessReport, BusinessReportQuery } from '@panesypan/shared';
import { trusted, type Types } from 'mongoose';
import { CashMovementModel } from '../cash/cash-movement.model';
import { CashShiftModel } from '../cash/cash-shift.model';
import { CategoryModel, ProductModel } from '../catalog/catalog.models';
import { StockMovementModel } from '../inventory/inventory.models';
import { listInventory } from '../inventory/inventory.service';
import { PurchaseModel } from '../purchases/purchases.models';
import { SaleModel } from '../sales/sale.model';

/** Suma montos agrupando por nombre, de mayor a menor. */
class Tally {
  private readonly rows = new Map<string, { amount: number; count: number }>();

  add(name: string, amount: number): void {
    const row = this.rows.get(name) ?? { amount: 0, count: 0 };
    this.rows.set(name, { amount: row.amount + amount, count: row.count + 1 });
  }

  list(): { name: string; amount: number; count: number }[] {
    return [...this.rows.entries()]
      .map(([name, row]) => ({ name, ...row }))
      .sort((a, b) => b.amount - a.amount);
  }
}

/**
 * Reporte del negocio en un rango de días: ventas, costo de lo vendido, gastos por tipo,
 * nómina por persona, compras por proveedor, mermas y autoconsumo al costo, y la utilidad
 * estimada. Los retiros del dueño no son gasto.
 */
export async function getBusinessReport(query: BusinessReportQuery): Promise<BusinessReport> {
  const range = trusted({ $gte: query.from, $lte: query.to });
  const [sales, shifts, purchases, losses, products, categories, inventory] = await Promise.all([
    SaleModel.find({ status: 'PAID', businessDate: range })
      .select('lines total businessDate returns')
      .lean(),
    CashShiftModel.find({ businessDate: range }).select('_id').lean(),
    PurchaseModel.find({ businessDate: range }).lean(),
    StockMovementModel.find({
      businessDate: range,
      type: trusted({ $in: ['WASTE', 'SELF_CONSUMPTION'] }),
    }).lean(),
    ProductModel.find().select('name categoryId cost subcategory').lean(),
    CategoryModel.find().select('name').lean(),
    listInventory({}),
  ]);

  const categoryName = new Map(
    categories.map((category) => [category._id.toString(), category.name]),
  );
  const productById = new Map(products.map((product) => [product._id.toString(), product]));
  const costOf = (productId: Types.ObjectId): number | null =>
    productById.get(productId.toString())?.cost ?? null;

  // ── Ventas ──
  let salesTotal = 0;
  let returnsTotal = 0;
  let costOfSales = 0;
  let unitsWithoutCost = 0;
  const byDay = new Map<string, { total: number; count: number }>();
  const byProduct = new Map<string, { name: string; quantity: number; total: number }>();
  for (const sale of sales) {
    salesTotal += sale.total;
    const day = byDay.get(sale.businessDate ?? '') ?? { total: 0, count: 0 };
    byDay.set(sale.businessDate ?? '', { total: day.total + sale.total, count: day.count + 1 });
    const returned = new Map<string, number>();
    for (const entry of sale.returns) {
      returnsTotal += entry.amount;
      for (const line of entry.lines) {
        const key = line.lineId.toString();
        returned.set(key, (returned.get(key) ?? 0) + line.quantity);
      }
    }
    for (const line of sale.lines) {
      const quantity = line.quantity - (returned.get(line._id.toString()) ?? 0);
      const cost = costOf(line.productId);
      if (cost === null) unitsWithoutCost += quantity;
      else costOfSales += cost * quantity;
      const key = line.productId.toString();
      const row = byProduct.get(key) ?? { name: line.name, quantity: 0, total: 0 };
      byProduct.set(key, {
        name: row.name,
        quantity: row.quantity + quantity,
        total: row.total + Math.round((line.total * quantity) / line.quantity),
      });
    }
  }
  const productRows = [...byProduct.entries()]
    .map(([productId, row]) => {
      const product = productById.get(productId);
      return {
        productId,
        name: row.name,
        categoryName:
          product === undefined ? '' : (categoryName.get(product.categoryId.toString()) ?? ''),
        quantity: row.quantity,
        total: row.total,
      };
    })
    .sort((a, b) => b.total - a.total);
  const byCategory = new Map<string, { quantity: number; total: number }>();
  const bySubcategory = new Map<string, { quantity: number; total: number }>();
  for (const row of productRows) {
    const subcategory = productById.get(row.productId)?.subcategory ?? '';
    if (subcategory !== '') {
      const key = `${row.categoryName} › ${subcategory}`;
      const current = bySubcategory.get(key) ?? { quantity: 0, total: 0 };
      bySubcategory.set(key, {
        quantity: current.quantity + row.quantity,
        total: current.total + row.total,
      });
    }
    const name = row.categoryName === '' ? 'Sin categoría' : row.categoryName;
    const current = byCategory.get(name) ?? { quantity: 0, total: 0 };
    byCategory.set(name, {
      quantity: current.quantity + row.quantity,
      total: current.total + row.total,
    });
  }

  // ── Caja: egresos, nómina, retiros, ingresos ──
  const fromPurchases = new Set(
    purchases.flatMap((purchase) =>
      purchase.cashMovementId === null ? [] : [purchase.cashMovementId.toString()],
    ),
  );
  const movements = await CashMovementModel.find({
    shiftId: trusted({ $in: shifts.map((shift) => shift._id) }),
  }).lean();
  const expenses = new Tally();
  const payroll = new Tally();
  let expensesTotal = 0;
  let withdrawalsTotal = 0;
  let incomesTotal = 0;
  for (const movement of movements) {
    if (movement.type === 'WITHDRAWAL') withdrawalsTotal += movement.amount;
    else if (movement.type === 'INCOME') incomesTotal += movement.amount;
    else if (!fromPurchases.has(movement._id.toString())) {
      expensesTotal += movement.amount;
      expenses.add(movement.concept?.name ?? 'Sin tipo', movement.amount);
      if (movement.staff !== null) payroll.add(movement.staff.name, movement.amount);
    }
  }

  // ── Compras ──
  const suppliers = new Tally();
  let suppliesTotal = 0;
  for (const purchase of purchases) {
    suppliers.add(purchase.supplier.name, purchase.total);
    for (const line of purchase.lines) if (line.productId === null) suppliesTotal += line.total;
  }

  // ── Mermas y autoconsumo al costo ──
  const lossRows = new Map<string, { wasted: number; consumed: number; value: number }>();
  let wasteValue = 0;
  let selfConsumptionValue = 0;
  for (const movement of losses) {
    const units = Math.abs(movement.delta);
    const value = units * (costOf(movement.productId) ?? 0);
    const row = lossRows.get(movement.productName) ?? { wasted: 0, consumed: 0, value: 0 };
    if (movement.type === 'WASTE') {
      wasteValue += value;
      row.wasted += units;
    } else {
      selfConsumptionValue += value;
      row.consumed += units;
    }
    row.value += value;
    lossRows.set(movement.productName, row);
  }

  const netSales = salesTotal - returnsTotal;
  return {
    from: query.from,
    to: query.to,
    salesCount: sales.length,
    salesTotal,
    returnsTotal,
    netSales,
    costOfSales,
    unitsWithoutCost,
    expensesTotal,
    suppliesTotal,
    wasteValue,
    selfConsumptionValue,
    estimatedProfit:
      netSales - costOfSales - expensesTotal - suppliesTotal - wasteValue - selfConsumptionValue,
    withdrawalsTotal,
    incomesTotal,
    byDay: [...byDay.entries()]
      .map(([date, row]) => ({ date, ...row }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byCategory: [...byCategory.entries()]
      .map(([name, row]) => ({ name, ...row }))
      .sort((a, b) => b.total - a.total),
    bySubcategory: [...bySubcategory.entries()]
      .map(([name, row]) => ({ name, ...row }))
      .sort((a, b) => b.total - a.total),
    byProduct: productRows,
    expensesByConcept: expenses.list(),
    payrollByStaff: payroll.list(),
    purchasesBySupplier: suppliers.list(),
    lossesByProduct: [...lossRows.entries()]
      .map(([name, row]) => ({ name, ...row }))
      .sort((a, b) => b.value - a.value),
    stockValue: inventory.totalValue ?? 0,
  };
}
