import type { WebOrder, WebOrderStatus } from '@panesypan/shared';

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
