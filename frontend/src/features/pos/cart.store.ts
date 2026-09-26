import { lunchChoiceLabel, SALE_LIMITS, type LunchChoice } from '@panesypan/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface CartLine {
  /** Producto + elección + nota: el mismo almuerzo con otra proteína es otra línea. */
  key: string;
  productId: string;
  quantity: number;
  note: string;
  /** Proteína, principio y sopa del almuerzo (null en los demás productos). */
  lunch?: LunchChoice | null;
}

interface CartState {
  lines: CartLine[];
  add: (productId: string, note?: string, lunch?: LunchChoice | null) => void;
  /** Cantidad 0 = quitar la línea. */
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
}

const lineKey = (productId: string, note: string, lunch: LunchChoice | null): string =>
  `${productId}|${lunch === null ? '' : lunchChoiceLabel(lunch)}|${note}`;

/**
 * Pedido de mostrador que se está armando. Solo guarda qué y cuánto: el nombre y el precio
 * salen siempre del catálogo actual, y el precio final lo decide la API al cobrar.
 * Se conserva en la pestaña (sessionStorage) por si la tablet recarga la página.
 */
export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      add: (productId, note = '', lunch = null) => {
        set((state) => {
          const key = lineKey(productId, note, lunch);
          const existing = state.lines.find((line) => line.key === key);
          if (existing === undefined) {
            return { lines: [...state.lines, { key, productId, quantity: 1, note, lunch }] };
          }
          return {
            lines: state.lines.map((line) =>
              line.key === key
                ? { ...line, quantity: Math.min(SALE_LIMITS.maxQuantity, line.quantity + 1) }
                : line,
            ),
          };
        });
      },
      setQuantity: (key, quantity) => {
        set((state) => ({
          lines:
            quantity <= 0
              ? state.lines.filter((line) => line.key !== key)
              : state.lines.map((line) =>
                  line.key === key
                    ? { ...line, quantity: Math.min(SALE_LIMITS.maxQuantity, quantity) }
                    : line,
                ),
        }));
      },
      clear: () => {
        set({ lines: [] });
      },
    }),
    { name: 'pyp-pedido-mostrador', storage: createJSONStorage(() => sessionStorage) },
  ),
);
