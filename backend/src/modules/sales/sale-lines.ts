import { lineTotal } from '@panesypan/shared';
import { trusted, Types, type ClientSession } from 'mongoose';
import { AppError } from '../../lib/errors';
import { CategoryModel, DailyMenuModel, ProductModel } from '../catalog/catalog.models';
import { newLineId, type SaleLineAttrs } from './sale.model';

export interface SellableProduct {
  id: string;
  _id: Types.ObjectId;
  name: string;
  price: number;
  isLunch: boolean;
}

const outOfStock = (message: string): AppError => new AppError(409, 'OUT_OF_STOCK', message);

/**
 * Carga los productos que se quieren vender y verifica que se puedan vender ahora:
 * activos, disponibles (no agotados) y de una categoría activa. El precio sale de aquí,
 * nunca de lo que envía la tablet.
 */
export async function loadSellableProducts(
  productIds: readonly string[],
  session?: ClientSession,
): Promise<Map<string, SellableProduct>> {
  const unique = [...new Set(productIds)];
  const products = await ProductModel.find({
    _id: trusted({ $in: unique.map((id) => new Types.ObjectId(id)) }),
  }).session(session ?? null);
  const categories = await CategoryModel.find({
    _id: trusted({ $in: products.map((product) => product.categoryId) }),
  }).session(session ?? null);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const result = new Map<string, SellableProduct>();
  for (const id of unique) {
    const product = products.find((item) => item.id === id);
    if (product?.isActive !== true) {
      throw new AppError(
        404,
        'NOT_FOUND',
        'Un producto del pedido ya no existe. Recarga la página.',
      );
    }
    const category = categoryById.get(product.categoryId.toString());
    if (category?.isActive !== true) throw outOfStock(`${product.name} no está a la venta`);
    if (!product.isAvailable) throw outOfStock(`${product.name} está agotado`);
    result.set(id, {
      id,
      _id: product._id,
      name: product.name,
      price: product.price,
      isLunch: category.kind === 'LUNCH',
    });
  }
  return result;
}

export function buildLine(
  product: SellableProduct,
  quantity: number,
  note: string,
  today: string,
): SaleLineAttrs {
  return {
    _id: newLineId(),
    productId: product._id,
    name: product.name,
    unitPrice: product.price,
    quantity,
    note,
    total: lineTotal({ unitPrice: product.price, quantity }),
    isLunch: product.isLunch,
    menuDate: product.isLunch ? today : null,
  };
}

export interface PortionChange {
  productId: Types.ObjectId;
  name: string;
  menuDate: string;
  /** Positivo: se venden porciones. Negativo: se devuelven (se quitó de la mesa, se anuló…). */
  delta: number;
}

/** Porciones que mueve un conjunto de líneas (solo almuerzos). */
export function portionChangesOf(lines: readonly SaleLineAttrs[], sign: 1 | -1): PortionChange[] {
  return lines.flatMap((line) =>
    line.isLunch && line.menuDate !== null
      ? [
          {
            productId: line.productId,
            name: line.name,
            menuDate: line.menuDate,
            delta: sign * line.quantity,
          },
        ]
      : [],
  );
}

/**
 * Descuenta o devuelve porciones del menú del día dentro de la transacción. Si dos cajeras
 * venden la última porción al mismo tiempo, MongoDB aborta una transacción, se reintenta
 * y la segunda ve que ya no quedan.
 */
export async function adjustPortions(
  changes: readonly PortionChange[],
  session: ClientSession,
): Promise<void> {
  const merged = new Map<string, PortionChange>();
  for (const change of changes) {
    if (change.delta === 0) continue;
    const key = `${change.menuDate}|${change.productId.toString()}`;
    const current = merged.get(key);
    merged.set(
      key,
      current === undefined ? { ...change } : { ...current, delta: current.delta + change.delta },
    );
  }

  const dates = new Set([...merged.values()].map((change) => change.menuDate));
  for (const date of dates) {
    const menu = await DailyMenuModel.findOne({ date }).session(session);
    let modified = false;
    for (const change of merged.values()) {
      if (change.menuDate !== date || change.delta === 0) continue;
      const offering = menu?.offerings.find((item) => item.productId.equals(change.productId));

      if (change.delta < 0) {
        if (offering !== undefined) {
          offering.sold = Math.max(0, offering.sold + change.delta);
          modified = true;
        }
        continue;
      }
      if (menu?.isPublished !== true || offering === undefined) {
        throw outOfStock(`${change.name} no está en el menú de hoy`);
      }
      if (offering.portions !== null && offering.sold + change.delta > offering.portions) {
        const left = Math.max(0, offering.portions - offering.sold);
        throw outOfStock(
          left === 0
            ? `Se acabaron las porciones de ${change.name}`
            : `Solo quedan ${String(left)} porciones de ${change.name}`,
        );
      }
      offering.sold += change.delta;
      modified = true;
    }
    if (menu !== null && modified) await menu.save({ session });
  }
}
