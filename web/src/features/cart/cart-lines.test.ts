import { WEB_ORDER_LIMITS } from '@panesypan/shared';
import { describe, expect, it } from 'vitest';
import { addLine, lineKey, parseStoredCart, setLineQuantity, type CartItem } from './cart-lines';

const almuerzo = { id: 'a1', name: 'Almuerzo', price: 14_000 };
const pan = { id: 'p1', name: 'Pan Coco', price: 800 };
const pollo = { protein: 'Pollo', principle: 'Fríjoles', soup: 'Sancocho' };

describe('carrito de la web', () => {
  it('mismo producto y misma elección suman; otra elección es otra línea', () => {
    let cart: readonly CartItem[] = [];
    cart = addLine(cart, pan, null);
    cart = addLine(cart, pan, null);
    cart = addLine(cart, almuerzo, pollo);
    cart = addLine(cart, almuerzo, pollo);
    cart = addLine(cart, almuerzo, { ...pollo, soup: null });
    expect(cart.map((item) => [item.name, item.quantity, item.lunch?.soup ?? '-'])).toEqual([
      ['Pan Coco', 2, '-'],
      ['Almuerzo', 2, 'Sancocho'],
      ['Almuerzo', 1, '-'],
    ]);
  });

  it('cantidad 0 quita la línea y el máximo se respeta', () => {
    const cart = addLine([], pan, null);
    const [first] = cart;
    if (first === undefined) throw new Error('Carrito vacío');
    const key = lineKey(first);
    expect(setLineQuantity(cart, key, 0)).toEqual([]);
    expect(setLineQuantity(cart, key, 9_999)[0]?.quantity).toBe(WEB_ORDER_LIMITS.quantityMax);
  });

  it('lee carritos guardados: migra líneas viejas y descarta las inválidas', () => {
    const stored = [
      { productId: 'p1', name: 'Pan Coco', price: 800, quantity: 2 },
      { productId: 'a1', name: 'Almuerzo', price: 14_000, quantity: 1, lunch: pollo },
      { productId: 'a1', name: 'Almuerzo', price: 14_000, quantity: 1, lunch: { protein: '' } },
      { productId: 'x', name: 'Roto', price: 1, quantity: 0 },
      'basura',
    ];
    const cart = parseStoredCart(stored);
    expect(cart.map((item) => [item.productId, item.lunch])).toEqual([
      ['p1', null],
      ['a1', pollo],
    ]);
    expect(parseStoredCart('no es una lista')).toEqual([]);
  });
});
