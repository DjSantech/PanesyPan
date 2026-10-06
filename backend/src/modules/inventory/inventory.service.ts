import {
  slugify,
  toBusinessDate,
  type AdjustStockRequest,
  type InventoryItem,
  type ListInventoryQuery,
  type ListInventoryResponse,
  type ListMovementsQuery,
  type RegisterProductionRequest,
  type RegisterWasteRequest,
  type SetMinStockRequest,
  type StockMovement,
  type StockMovementType,
  type WasteReason,
} from '@panesypan/shared';
import { trusted, Types, type ClientSession, type QueryFilter } from 'mongoose';
import { AppError } from '../../lib/errors';
import { escapeRegex } from '../../lib/regex';
import { recordAudit } from '../audit/audit.service';
import { CategoryModel, ProductModel, type ProductDocument } from '../catalog/catalog.models';
import { toAuditActor } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import {
  InventoryItemModel,
  StockMovementModel,
  type StockMovementAttrs,
  type StockMovementDocument,
} from './inventory.models';

const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);

// ── Mapeo a DTO ────────────────────────────────────────────────────

export function toMovementDto(movement: StockMovementDocument): StockMovement {
  return {
    id: movement.id,
    productId: movement.productId.toString(),
    productName: movement.productName,
    type: movement.type,
    delta: movement.delta,
    quantityAfter: movement.quantityAfter,
    reason: movement.reason,
    note: movement.note,
    businessDate: movement.businessDate,
    by: { id: movement.by.id.toString(), name: movement.by.name },
    createdAt: movement.createdAt.toISOString(),
  };
}

export const isLowStock = (quantity: number, minStock: number): boolean =>
  minStock > 0 && quantity <= minStock;

/** Arma las filas de inventario de un conjunto de productos (existencias y movimientos de hoy). */
async function buildItems(products: readonly ProductDocument[]): Promise<InventoryItem[]> {
  if (products.length === 0) return [];
  const productIds = products.map((product) => product._id);
  const [categories, stock, totals] = await Promise.all([
    CategoryModel.find({ _id: trusted({ $in: products.map((product) => product.categoryId) }) }),
    InventoryItemModel.find({ productId: trusted({ $in: productIds }) }),
    StockMovementModel.aggregate<{
      _id: { productId: Types.ObjectId; type: string };
      total: number;
    }>([
      {
        $match: {
          businessDate: toBusinessDate(),
          type: { $in: ['PRODUCTION', 'WASTE'] },
          productId: { $in: productIds },
        },
      },
      {
        $group: {
          _id: { productId: '$productId', type: '$type' },
          total: { $sum: { $abs: '$delta' } },
        },
      },
    ]),
  ]);
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const stockByProduct = new Map(stock.map((item) => [item.productId.toString(), item]));
  const today = new Map(
    totals.map((row) => [`${row._id.productId.toString()}|${row._id.type}`, row.total]),
  );

  return products.map((product) => {
    const item = stockByProduct.get(product.id);
    const quantity = item?.quantity ?? 0;
    const minStock = item?.minStock ?? 0;
    return {
      productId: product.id,
      name: product.name,
      categoryName: categoryName.get(product.categoryId.toString()) ?? '',
      quantity,
      cost: product.cost ?? null,
      minStock,
      isLow: isLowStock(quantity, minStock),
      producedToday: today.get(`${product.id}|PRODUCTION`) ?? 0,
      wastedToday: today.get(`${product.id}|WASTE`) ?? 0,
    };
  });
}

/** Inventario valorizado: stock × costo de los productos que tienen costo. */
export function stockValueOf(items: readonly Pick<InventoryItem, 'quantity' | 'cost'>[]): number {
  return items.reduce((sum, item) => sum + item.quantity * (item.cost ?? 0), 0);
}

async function findTrackedProduct(productId: string): Promise<ProductDocument> {
  const product = await ProductModel.findById(productId);
  if (product === null) throw new AppError(404, 'NOT_FOUND', 'Producto no encontrado');
  if (!product.isActive || !product.trackStock) {
    throw conflict(`"${product.name}" no controla inventario. Actívalo en el catálogo.`);
  }
  return product;
}

async function itemFor(product: ProductDocument): Promise<InventoryItem> {
  const [item] = await buildItems([product]);
  if (item === undefined) throw new AppError(404, 'NOT_FOUND', 'Producto no encontrado');
  return item;
}

// ── Consultas ──────────────────────────────────────────────────────

export async function listInventory(query: ListInventoryQuery): Promise<ListInventoryResponse> {
  const filter: QueryFilter<{ isActive: boolean; trackStock: boolean; slug: RegExp }> = {
    isActive: true,
    trackStock: true,
  };
  if (query.search !== undefined && query.search.length > 0) {
    filter.slug = new RegExp(escapeRegex(slugify(query.search)), 'i');
  }
  const products = await ProductModel.find(filter).sort({ sortOrder: 1, name: 1 }).limit(1_000);
  const all = await buildItems(products);
  const items = query.lowStock === 'true' ? all.filter((item) => item.isLow) : all;
  return {
    items,
    lowStockCount: all.filter((item) => item.isLow).length,
    totalValue: stockValueOf(all),
    withoutCost: all.filter((item) => item.cost === null && item.quantity > 0).length,
  };
}

export async function listMovements(query: ListMovementsQuery): Promise<StockMovement[]> {
  const filter: QueryFilter<StockMovementAttrs> = {
    businessDate: query.date ?? toBusinessDate(),
  };
  if (query.type !== undefined) filter.type = query.type;
  if (query.productId !== undefined) filter.productId = new Types.ObjectId(query.productId);
  const movements = await StockMovementModel.find(filter).sort({ createdAt: -1 }).limit(500);
  return movements.map(toMovementDto);
}

// ── Movimientos manuales ───────────────────────────────────────────

interface MovementInput {
  product: Pick<ProductDocument, '_id' | 'name'>;
  type: StockMovementType;
  delta: number;
  quantityAfter: number;
  reason?: WasteReason;
  note?: string;
  by: { id: Types.ObjectId; name: string };
  saleId?: Types.ObjectId;
}

async function insertMovement(input: MovementInput, session?: ClientSession): Promise<void> {
  await StockMovementModel.create(
    [
      {
        productId: input.product._id,
        productName: input.product.name,
        type: input.type,
        delta: input.delta,
        quantityAfter: input.quantityAfter,
        reason: input.reason ?? null,
        note: input.note ?? '',
        businessDate: toBusinessDate(),
        by: input.by,
        saleId: input.saleId ?? null,
      },
    ],
    { session },
  );
}

const byOf = (ctx: ActorContext) => ({ id: ctx.actor._id, name: ctx.actor.name });

const productEntity = (product: ProductDocument) => ({
  type: 'PRODUCT',
  id: product.id,
  label: product.name,
});

export async function registerProduction(
  input: RegisterProductionRequest,
  ctx: ActorContext,
): Promise<InventoryItem> {
  const product = await findTrackedProduct(input.productId);
  const item = await InventoryItemModel.findOneAndUpdate(
    { productId: product._id },
    { $inc: { quantity: input.quantity } },
    { upsert: true, returnDocument: 'after' },
  );
  await insertMovement({
    product,
    type: 'PRODUCTION',
    delta: input.quantity,
    quantityAfter: item.quantity,
    note: input.note ?? '',
    by: byOf(ctx),
  });
  await recordAudit(
    {
      action: 'STOCK_PRODUCTION_LOGGED',
      actor: toAuditActor(ctx.actor),
      entity: productEntity(product),
      metadata: { quantity: input.quantity, stock: item.quantity, note: input.note ?? '' },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return itemFor(product);
}

export async function registerWaste(
  input: RegisterWasteRequest,
  ctx: ActorContext,
): Promise<InventoryItem> {
  const product = await findTrackedProduct(input.productId);
  // La condición sobre la cantidad hace que dos mermas simultáneas nunca dejen el stock negativo.
  const item = await InventoryItemModel.findOneAndUpdate(
    { productId: product._id, quantity: trusted({ $gte: input.quantity }) },
    { $inc: { quantity: -input.quantity } },
    { returnDocument: 'after' },
  );
  if (item === null) {
    const current = await InventoryItemModel.findOne({ productId: product._id });
    throw conflict(
      `No hay suficiente stock de "${product.name}": quedan ${String(current?.quantity ?? 0)}.`,
    );
  }
  await insertMovement({
    product,
    type: 'WASTE',
    delta: -input.quantity,
    quantityAfter: item.quantity,
    reason: input.reason,
    note: input.note ?? '',
    by: byOf(ctx),
  });
  await recordAudit(
    {
      action: 'STOCK_WASTE_LOGGED',
      actor: toAuditActor(ctx.actor),
      entity: productEntity(product),
      metadata: {
        quantity: input.quantity,
        reason: input.reason,
        stock: item.quantity,
        note: input.note ?? '',
      },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return itemFor(product);
}

/** Conteo físico: deja el stock en la cantidad contada y registra la diferencia. */
export async function adjustStock(
  input: AdjustStockRequest,
  ctx: ActorContext,
): Promise<InventoryItem> {
  const product = await findTrackedProduct(input.productId);
  const before = await InventoryItemModel.findOneAndUpdate(
    { productId: product._id },
    { $set: { quantity: input.newQuantity } },
    { upsert: true, returnDocument: 'before' },
  );
  const previous = before?.quantity ?? 0;
  if (previous === input.newQuantity) return itemFor(product);

  await insertMovement({
    product,
    type: 'ADJUSTMENT',
    delta: input.newQuantity - previous,
    quantityAfter: input.newQuantity,
    note: input.note,
    by: byOf(ctx),
  });
  await recordAudit(
    {
      action: 'STOCK_ADJUSTED',
      actor: toAuditActor(ctx.actor),
      entity: productEntity(product),
      metadata: { changes: { stock: { from: previous, to: input.newQuantity } }, note: input.note },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return itemFor(product);
}

export async function setMinStock(
  productId: string,
  input: SetMinStockRequest,
  ctx: ActorContext,
): Promise<InventoryItem> {
  const product = await findTrackedProduct(productId);
  const before = await InventoryItemModel.findOneAndUpdate(
    { productId: product._id },
    { $set: { minStock: input.minStock } },
    { upsert: true, returnDocument: 'before' },
  );
  const previous = before?.minStock ?? 0;
  if (previous !== input.minStock) {
    await recordAudit(
      {
        action: 'STOCK_MIN_UPDATED',
        actor: toAuditActor(ctx.actor),
        entity: productEntity(product),
        metadata: { changes: { minStock: { from: previous, to: input.minStock } } },
        meta: ctx.meta,
      },
      ctx.logger,
    );
  }
  return itemFor(product);
}

// ── Ventas ─────────────────────────────────────────────────────────

export interface StockLine {
  productId: Types.ObjectId;
  quantity: number;
}

/**
 * Descuenta (sign = 1) o devuelve (sign = -1) las unidades de una venta en los productos que
 * controlan inventario. Corre dentro de la transacción de la venta: si falta stock, se
 * aborta el cobro completo y no queda nada a medias.
 */
export async function applySaleStock(
  lines: readonly StockLine[],
  sign: 1 | -1,
  by: { id: Types.ObjectId; name: string },
  saleId: Types.ObjectId,
  session: ClientSession,
): Promise<void> {
  const quantityByProduct = new Map<string, { productId: Types.ObjectId; quantity: number }>();
  for (const line of lines) {
    const key = line.productId.toString();
    const current = quantityByProduct.get(key);
    quantityByProduct.set(key, {
      productId: line.productId,
      quantity: (current?.quantity ?? 0) + line.quantity,
    });
  }
  if (quantityByProduct.size === 0) return;

  const tracked = await ProductModel.find({
    _id: trusted({ $in: [...quantityByProduct.values()].map((entry) => entry.productId) }),
    trackStock: true,
  }).session(session);

  for (const product of tracked) {
    const quantity = quantityByProduct.get(product.id)?.quantity ?? 0;
    if (quantity === 0) continue;

    let quantityAfter: number;
    if (sign === 1) {
      const item = await InventoryItemModel.findOneAndUpdate(
        { productId: product._id, quantity: trusted({ $gte: quantity }) },
        { $inc: { quantity: -quantity } },
        { returnDocument: 'after', session },
      );
      if (item === null) {
        const current = await InventoryItemModel.findOne({ productId: product._id }).session(
          session,
        );
        const left = current?.quantity ?? 0;
        throw new AppError(
          409,
          'OUT_OF_STOCK',
          left === 0
            ? `Se acabó el inventario de ${product.name}`
            : `Solo quedan ${String(left)} unidades de ${product.name}`,
        );
      }
      quantityAfter = item.quantity;
    } else {
      const item = await InventoryItemModel.findOneAndUpdate(
        { productId: product._id },
        { $inc: { quantity } },
        { upsert: true, returnDocument: 'after', session },
      );
      quantityAfter = item.quantity;
    }
    await insertMovement(
      {
        product,
        type: sign === 1 ? 'SALE' : 'SALE_VOID',
        delta: sign * -quantity,
        quantityAfter,
        by,
        saleId,
      },
      session,
    );
  }
}
