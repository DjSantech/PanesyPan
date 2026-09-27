'use client';

import type { LunchChoice } from '@panesypan/shared';
import { useSyncExternalStore } from 'react';
import {
  addLine,
  parseStoredCart,
  setLineQuantity,
  type CartItem,
  type CartProduct,
} from './cart-lines';

export { lineKey, type CartItem } from './cart-lines';

const STORAGE_KEY = 'pyp-carrito-v1';
const EMPTY: readonly CartItem[] = [];

let items: readonly CartItem[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    items = parseStoredCart(parsed);
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

export function addToCart(product: CartProduct, lunch: LunchChoice | null = null): void {
  load();
  const next = addLine(items, product, lunch);
  if (next !== items) save(next);
}

/** Cambia la cantidad de una línea (ver `lineKey`); 0 la quita. */
export function setQuantity(key: string, quantity: number): void {
  load();
  save(setLineQuantity(items, key, quantity));
}

export function clearCart(): void {
  save(EMPTY);
}

export const cartCount = (list: readonly CartItem[]): number =>
  list.reduce((sum, item) => sum + item.quantity, 0);

export const cartSubtotal = (list: readonly CartItem[]): number =>
  list.reduce((sum, item) => sum + item.price * item.quantity, 0);
