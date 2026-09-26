'use client';

import { WEB_ORDER_LIMITS } from '@panesypan/shared';
import { useSyncExternalStore } from 'react';

/** Producto en el carrito. El precio es solo para mostrar: el servidor recalcula todo. */
export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
}

const STORAGE_KEY = 'pyp-carrito-v1';
const EMPTY: readonly CartItem[] = [];

let items: readonly CartItem[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.productId === 'string' &&
    typeof v.name === 'string' &&
    typeof v.price === 'number' &&
    typeof v.quantity === 'number' &&
    Number.isInteger(v.quantity) &&
    v.quantity >= 1
  );
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (Array.isArray(parsed)) {
      items = parsed
        .filter(isCartItem)
        .slice(0, WEB_ORDER_LIMITS.linesMax)
        .map((item) => ({
          ...item,
          quantity: Math.min(item.quantity, WEB_ORDER_LIMITS.quantityMax),
        }));
    }
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): el carrito vive solo en memoria.
  }
}

function save(next: readonly CartItem[]): void {
  items = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Igual que al leer: si no se puede guardar, el carrito sigue en memoria.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    loaded = false;
    load();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): readonly CartItem[] {
  load();
  return items;
}

const getServerSnapshot = (): readonly CartItem[] => EMPTY;

export function useCart(): readonly CartItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function addToCart(product: { id: string; name: string; price: number }): void {
  load();
  const existing = items.find((item) => item.productId === product.id);
  if (existing === undefined) {
    if (items.length >= WEB_ORDER_LIMITS.linesMax) return;
    save([
      ...items,
      { productId: product.id, name: product.name, price: product.price, quantity: 1 },
    ]);
    return;
  }
  setQuantity(product.id, existing.quantity + 1);
}

export function setQuantity(productId: string, quantity: number): void {
  load();
  if (quantity <= 0) {
    save(items.filter((item) => item.productId !== productId));
    return;
  }
  const capped = Math.min(Math.floor(quantity), WEB_ORDER_LIMITS.quantityMax);
  save(items.map((item) => (item.productId === productId ? { ...item, quantity: capped } : item)));
}

export function clearCart(): void {
  save(EMPTY);
}

export const cartCount = (list: readonly CartItem[]): number =>
  list.reduce((sum, item) => sum + item.quantity, 0);

export const cartSubtotal = (list: readonly CartItem[]): number =>
  list.reduce((sum, item) => sum + item.price * item.quantity, 0);
