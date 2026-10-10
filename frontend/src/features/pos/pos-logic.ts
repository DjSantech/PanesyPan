import { lineTotal, unitPriceFor, type PriceTier } from '@panesypan/shared';

/**
 * Precio de una línea del pedido de mostrador con la misma regla que usa la API al cobrar
 * (precio por cantidad), para que el total que ve la cajera sea el que se cobra.
 */
export function counterLinePrice(
  product: { price: number; priceTiers?: readonly PriceTier[] } | undefined,
  quantity: number,
): { unitPrice: number; listPrice: number; total: number } {
  if (product === undefined) return { unitPrice: 0, listPrice: 0, total: 0 };
  const unitPrice = unitPriceFor(product, quantity);
  return { unitPrice, listPrice: product.price, total: lineTotal({ unitPrice, quantity }) };
}
