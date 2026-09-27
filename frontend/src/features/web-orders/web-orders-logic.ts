import {
  canCancelWebOrder,
  canCheckoutWebOrder,
  formatCOP,
  lunchChoiceLabel,
  type WebOrder,
  type WebOrderStatus,
} from '@panesypan/shared';

export const STATUS_TONE: Record<
  WebOrderStatus,
  'pending' | 'primary' | 'accent' | 'success' | 'neutral'
> = {
  PENDING: 'pending',
  CONFIRMED: 'primary',
  DISPATCHED: 'accent',
  DELIVERED: 'success',
  CANCELED: 'neutral',
};

/** Texto del botón que lleva al siguiente estado. */
export const NEXT_ACTION_LABEL: Record<WebOrderStatus, string | null> = {
  PENDING: 'Confirmar',
  CONFIRMED: 'Despachar',
  DISPATCHED: null,
  DELIVERED: null,
  CANCELED: null,
};

/** Enlace de WhatsApp al celular colombiano del cliente (10 dígitos). */
export function customerWhatsappUrl(phone: string, orderNumber: number): string {
  const digits = phone.replace(/\D/g, '');
  const text = encodeURIComponent(
    `Hola, te escribimos de Panes & Panes por tu pedido web #${String(orderNumber)}.`,
  );
  return `https://wa.me/57${digits}?text=${text}`;
}

/** Pendientes primero; dentro de cada estado, los más antiguos arriba (se atienden en orden). */
export function sortWebOrders(orders: readonly WebOrder[]): WebOrder[] {
  const rank: Record<WebOrderStatus, number> = {
    PENDING: 0,
    CONFIRMED: 1,
    DISPATCHED: 2,
    DELIVERED: 3,
    CANCELED: 4,
  };
  return [...orders].sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (a.status === 'DELIVERED' || a.status === 'CANCELED'
        ? b.createdAt.localeCompare(a.createdAt)
        : a.createdAt.localeCompare(b.createdAt)),
  );
}

/** Qué acciones ve quien atiende el pedido, según su estado y sus permisos. */
export function webOrderActions(
  status: WebOrderStatus,
  perms: { manage: boolean; sell: boolean },
): { checkout: boolean; cancel: boolean } {
  return {
    checkout: perms.manage && perms.sell && canCheckoutWebOrder(status),
    cancel: perms.manage && canCancelWebOrder(status),
  };
}

/** Texto de la elección de almuerzo de una línea (null si no es almuerzo). */
export function lineLunchLabel(line: WebOrder['lines'][number]): string | null {
  return line.lunch === null ? null : lunchChoiceLabel(line.lunch);
}

/** Texto para la cajera: el domicilio lo recibe el domiciliario, no la caja. */
export function deliveryFeeNote(fee: number | null): string | null {
  return fee === null ? null : `El cliente le paga ${formatCOP(fee)} al domiciliario`;
}

/**
 * Pedidos pendientes que no se habían visto. Con `seen` en null (primera carga) no hay
 * ninguno nuevo: solo se recuerdan los que ya estaban.
 */
export function newPendingIds(
  orders: readonly WebOrder[],
  seen: ReadonlySet<string> | null,
): { fresh: WebOrder[]; seen: Set<string> } {
  const next = new Set(seen ?? []);
  const fresh: WebOrder[] = [];
  for (const order of orders) {
    if (next.has(order.id)) continue;
    next.add(order.id);
    if (seen !== null && order.status === 'PENDING') fresh.push(order);
  }
  return { fresh, seen: next };
}
