import type { WebOrder } from '@panesypan/shared';
import { describe, expect, it } from 'vitest';
import { customerWhatsappUrl, sortWebOrders } from './web-orders-logic';

const order = (number: number, status: WebOrder['status'], createdAt: string): WebOrder => ({
  id: String(number),
  number,
  status,
  customer: {
    name: 'Ana',
    phone: '3001234567',
    address: 'Cra 1',
    neighborhood: 'Centro',
    note: '',
  },
  lines: [],
  subtotal: 0,
  deliveryFee: null,
  total: 0,
  sale: null,
  cancelReason: null,
  createdAt,
  updatedAt: createdAt,
});

describe('pedidos web', () => {
  it('ordena pendientes primero y los más antiguos arriba', () => {
    const sorted = sortWebOrders([
      order(1, 'DELIVERED', '2026-09-25T10:00:00.000Z'),
      order(2, 'PENDING', '2026-09-25T12:00:00.000Z'),
      order(3, 'PENDING', '2026-09-25T11:00:00.000Z'),
      order(4, 'CONFIRMED', '2026-09-25T09:00:00.000Z'),
    ]);
    expect(sorted.map((o) => o.number)).toEqual([3, 2, 4, 1]);
  });

  it('arma el enlace de WhatsApp con el indicativo de Colombia', () => {
    expect(customerWhatsappUrl('300 123 4567', 7)).toMatch(
      /^https:\/\/wa\.me\/573001234567\?text=/,
    );
  });
});
