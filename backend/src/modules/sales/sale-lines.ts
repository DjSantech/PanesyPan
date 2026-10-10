import {
  lineTotal,
  lunchChoiceLabel,
  unitPriceFor,
  type LunchChoice,
  type PriceTier,
} from '@panesypan/shared';
import { trusted, Types, type ClientSession } from 'mongoose';
import { AppError } from '../../lib/errors';
import {
  CategoryModel,
  DailyMenuModel,
  ProductModel,
  type DailyMenuDocument,
} from '../catalog/catalog.models';
import { menuOptionsOf } from '../catalog/daily-menu.service';
import { newLineId, type SaleLineAttrs } from './sale.model';

export interface SellableProduct {
  id: string;
  _id: Types.ObjectId;
  name: string;
  price: number;
  /** Último costo del producto (null sin costo): queda guardado en la línea de la venta. */
  cost: number | null;
  isLunch: boolean;
  /** Precios por cantidad (sin indicar = siempre el precio normal; los almuerzos no tienen). */
  priceTiers?: readonly PriceTier[];
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
      cost: product.cost ?? null,
      isLunch: category.kind === 'LUNCH',
      priceTiers:
        category.kind === 'LUNCH'
          ? []
          : (product.priceTiers ?? []).map((tier) => ({
              minQuantity: tier.minQuantity,
              unitPrice: tier.unitPrice,
            })),
    });
  }
  return result;
}

/**
 * Arma la línea de venta. En un almuerzo, la elección (proteína, principio, sopa) va al
 * principio de la nota para que se lea en la cuenta, la comanda y el tiquete.
 */
export function buildLine(
  product: SellableProduct,
  quantity: number,
  note: string,
  today: string,
  lunch: LunchChoice | null = null,
): SaleLineAttrs {
  if (lunch !== null && !product.isLunch) {
    throw new AppError(400, 'VALIDATION_ERROR', `${product.name} no es un almuerzo`);
  }
  const priceTiers = product.isLunch ? [] : [...(product.priceTiers ?? [])];
  const unitPrice = unitPriceFor({ price: product.price, priceTiers }, quantity);
  return {
    _id: newLineId(),
    productId: product._id,
    name: product.name,
    unitPrice,
    listPrice: product.price,
    priceTiers,
    unitCost: product.cost,
    quantity,
    note: lunch === null ? note : [lunchChoiceLabel(lunch), note].filter(Boolean).join(' · '),
    total: lineTotal({ unitPrice, quantity }),
    isLunch: product.isLunch,
    menuDate: product.isLunch ? today : null,
    lunch,
  };
}

/**
 * Ajusta el precio de una línea a su nueva cantidad con las escalas que tenía al agregarse
 * (las líneas anteriores a los precios por cantidad conservan su precio).
 */
export function repriceLine(
  line: Pick<SaleLineAttrs, 'unitPrice' | 'listPrice' | 'priceTiers' | 'quantity' | 'total'>,
): void {
  if (line.listPrice !== undefined && line.listPrice !== null) {
    line.unitPrice = unitPriceFor(
      { price: line.listPrice, priceTiers: line.priceTiers ?? [] },
      line.quantity,
    );
  }
  line.total = lineTotal(line);
}

export interface PortionChange {
  productId: Types.ObjectId;
  name: string;
  menuDate: string;
  lunch: LunchChoice | null;
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
            lunch: line.lunch,
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
/** Verifica que la proteína, el principio y la sopa estén en el menú y no se hayan agotado. */
export function assertLunchChoice(
  menu: DailyMenuDocument,
  change: PortionChange,
  withChoices: boolean,
): void {
  const invalid = (message: string): AppError => new AppError(400, 'VALIDATION_ERROR', message);
  if (!withChoices) {
    if (change.lunch !== null) throw invalid(`${change.name} se vende sin elegir proteína`);
    return;
  }
  const { lunch } = change;
  if (lunch === null) throw invalid(`Elige la proteína y el principio de ${change.name}`);

  const options = menuOptionsOf(menu);
  const check = (list: { name: string; isAvailable: boolean }[], name: string, what: string) => {
    const option = list.find((item) => item.name === name);
    if (option === undefined) throw invalid(`${name} no es ${what} del menú de hoy`);
    if (!option.isAvailable) throw outOfStock(`Se acabó ${name}`);
  };
  check(options.proteins, lunch.protein, 'una proteína');
  check(options.principles, lunch.principle, 'un principio');
  if (lunch.soup !== null) check(options.soups, lunch.soup, 'una sopa');
  if (lunch.drink !== null) check(options.drinks, lunch.drink, 'una bebida');
}

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
    if (menu?.isPublished === true) {
      for (const change of changes) {
        if (change.menuDate !== date || change.delta <= 0) continue;
        const offering = menu.offerings.find((item) => item.productId.equals(change.productId));
        if (offering !== undefined) assertLunchChoice(menu, change, offering.withChoices);
      }
    }
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
