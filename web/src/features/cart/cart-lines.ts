import { lunchChoiceSchema, WEB_ORDER_LIMITS, type LunchChoice } from '@panesypan/shared';

/** Producto en el carrito. El precio es solo para mostrar: el servidor recalcula todo. */
export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  /** Elección del almuerzo; null en productos sin elección. */
  lunch: LunchChoice | null;
}

export interface CartProduct {
  id: string;
  name: string;
  price: number;
}

/** Clave estable de una línea: mismo producto y misma elección suman cantidad. */
export function lineKey(item: { productId: string; lunch: LunchChoice | null }): string {
  const { lunch } = item;
  if (lunch === null) return item.productId;
  return [item.productId, lunch.protein, lunch.principle, lunch.soup ?? ''].join('|');
}

/** Valida una línea guardada; las viejas sin `lunch` se migran con lunch null. */
export function parseStoredItem(value: unknown): CartItem | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.productId !== 'string' ||
    typeof v.name !== 'string' ||
    typeof v.price !== 'number' ||
    typeof v.quantity !== 'number' ||
    !Number.isInteger(v.quantity) ||
    v.quantity < 1
  ) {
    return null;
  }
  let lunch: LunchChoice | null = null;
  if (v.lunch !== undefined && v.lunch !== null) {
    const parsed = lunchChoiceSchema.safeParse(v.lunch);
    if (!parsed.success) return null;
    lunch = parsed.data;
  }
  return {
    productId: v.productId,
    name: v.name,
    price: v.price,
    quantity: Math.min(v.quantity, WEB_ORDER_LIMITS.quantityMax),
    lunch,
  };
}

export function parseStoredCart(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  const result: CartItem[] = [];
  for (const raw of value) {
    const item = parseStoredItem(raw);
    if (item !== null) result.push(item);
  }
  return result.slice(0, WEB_ORDER_LIMITS.linesMax);
}

export function addLine(
  list: readonly CartItem[],
  product: CartProduct,
  lunch: LunchChoice | null,
): readonly CartItem[] {
  const key = lineKey({ productId: product.id, lunch });
  const existing = list.find((item) => lineKey(item) === key);
  if (existing === undefined) {
    if (list.length >= WEB_ORDER_LIMITS.linesMax) return list;
    return [
      ...list,
      { productId: product.id, name: product.name, price: product.price, quantity: 1, lunch },
    ];
  }
  return setLineQuantity(list, key, existing.quantity + 1);
}

export function setLineQuantity(
  list: readonly CartItem[],
  key: string,
  quantity: number,
): readonly CartItem[] {
  if (quantity <= 0) return list.filter((item) => lineKey(item) !== key);
  const capped = Math.min(Math.floor(quantity), WEB_ORDER_LIMITS.quantityMax);
  return list.map((item) => (lineKey(item) === key ? { ...item, quantity: capped } : item));
}
