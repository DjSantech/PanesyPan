import { describe, expect, it } from 'vitest';
import { buildOrderMessage, whatsappUrl } from './whatsapp';

describe('mensaje de WhatsApp del pedido', () => {
  const order = {
    number: 17,
    status: 'PENDING' as const,
    lines: [
      {
        productId: 'a1',
        name: 'Almuerzo',
        unitPrice: 14_000,
        quantity: 1,
        total: 14_000,
        lunch: { protein: 'Pollo', principle: 'Fríjoles', soup: null },
      },
    ],
    subtotal: 14_000,
    deliveryFee: null,
    total: 14_000,
    createdAt: '2026-09-28T15:00:00.000Z',
  };
  const customer = {
    name: 'Ana',
    phone: '3001234567',
    address: 'Cra 16 # 40-20',
    neighborhood: 'Guadalupe',
    note: '',
  };

  it('incluye el número, la elección del almuerzo y el domicilio a cotizar', () => {
    const message = buildOrderMessage(order, customer);
    expect(message).toContain('pedido web #17');
    expect(message).toContain('Almuerzo (Pollo · Fríjoles · Sin sopa)');
    expect(message).toContain('Domicilio: lo cotiza el domiciliario');
    expect(message).not.toContain('Nota:');
  });

  it('sin WhatsApp configurado no arma enlace', () => {
    expect(whatsappUrl('', 'hola')).toBeNull();
    expect(whatsappUrl('57 312 244 7518', 'hola y chao')).toBe(
      'https://wa.me/573122447518?text=hola%20y%20chao',
    );
  });
});
