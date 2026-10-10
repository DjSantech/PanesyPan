import { describe, expect, it } from 'vitest';
import { formatPriceTiers, parsePriceTiers, priceTiersProblem, priceTiersSchema } from './catalog';
import { businessDateSchema, moneySchema, objectIdSchema } from './common';
import { databaseHealthResponseSchema } from './health';
import { counterCheckoutRequestSchema } from './sales';
import { updateBusinessSettingsRequestSchema } from './settings';

describe('esquemas comunes', () => {
  it('moneySchema solo acepta enteros no negativos', () => {
    expect(moneySchema.safeParse(12_500).success).toBe(true);
    expect(moneySchema.safeParse(0).success).toBe(true);
    expect(moneySchema.safeParse(12_500.5).success).toBe(false);
    expect(moneySchema.safeParse(-100).success).toBe(false);
    expect(moneySchema.safeParse('12500').success).toBe(false);
  });

  it('objectIdSchema valida ObjectId de 24 caracteres hexadecimales', () => {
    expect(objectIdSchema.safeParse('66f1a2b3c4d5e6f708192a3b').success).toBe(true);
    expect(objectIdSchema.safeParse('66f1a2b3').success).toBe(false);
    expect(objectIdSchema.safeParse({ $ne: null }).success).toBe(false);
  });

  it('businessDateSchema valida AAAA-MM-DD', () => {
    expect(businessDateSchema.safeParse('2026-09-23').success).toBe(true);
    expect(businessDateSchema.safeParse('2026-9-23').success).toBe(false);
  });
});

describe('databaseHealthResponseSchema', () => {
  it('acepta estado arriba y abajo', () => {
    expect(
      databaseHealthResponseSchema.safeParse({ status: 'ok', database: 'up', latencyMs: 3 })
        .success,
    ).toBe(true);
    expect(
      databaseHealthResponseSchema.safeParse({ status: 'error', database: 'down' }).success,
    ).toBe(true);
    expect(databaseHealthResponseSchema.safeParse({ status: 'ok', database: 'down' }).success).toBe(
      false,
    );
  });
});

describe('esquemas de venta', () => {
  const base = {
    clientRequestId: '3f0e8c1a-8f4b-4c2e-9d6a-2b7c1e5f9a10',
    expectedTotal: 5_000,
    payments: [{ method: 'CASH', amount: 5_000 }],
    lines: [{ productId: '66f1a2b3c4d5e6f708192a3b', quantity: 2 }],
  };

  it('acepta un cobro de mostrador y completa los valores por defecto', () => {
    const parsed = counterCheckoutRequestSchema.parse(base);
    expect(parsed.discount).toBeNull();
    expect(parsed.cashReceived).toBeNull();
    expect(parsed.lines[0]?.note).toBe('');
  });

  it('rechaza pedidos vacíos, cantidades en cero y campos desconocidos', () => {
    expect(counterCheckoutRequestSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(
      counterCheckoutRequestSchema.safeParse({
        ...base,
        lines: [{ productId: '66f1a2b3c4d5e6f708192a3b', quantity: 0 }],
      }).success,
    ).toBe(false);
    expect(counterCheckoutRequestSchema.safeParse({ ...base, total: 1 }).success).toBe(false);
    // El precio lo pone la API, nunca la tablet.
    expect(
      counterCheckoutRequestSchema.safeParse({
        ...base,
        lines: [{ productId: '66f1a2b3c4d5e6f708192a3b', quantity: 1, unitPrice: 1 }],
      }).success,
    ).toBe(false);
  });

  it('valida el descuento y el PIN del autorizador', () => {
    const discount = { mode: 'PERCENT', value: 120, reason: 'Cliente frecuente' };
    expect(counterCheckoutRequestSchema.safeParse({ ...base, discount }).success).toBe(false);
    expect(
      counterCheckoutRequestSchema.safeParse({ ...base, discount: { ...discount, value: 20 } })
        .success,
    ).toBe(true);
    expect(counterCheckoutRequestSchema.safeParse({ ...base, approverPin: '12a456' }).success).toBe(
      false,
    );
  });
});

describe('configuración del negocio', () => {
  it('valida NIT, mesas y tope de descuento', () => {
    expect(updateBusinessSettingsRequestSchema.safeParse({ taxId: '900.123.456-7' }).success).toBe(
      true,
    );
    expect(updateBusinessSettingsRequestSchema.safeParse({ taxId: 'ABC' }).success).toBe(false);
    expect(updateBusinessSettingsRequestSchema.safeParse({ tableCount: 51 }).success).toBe(false);
    expect(
      updateBusinessSettingsRequestSchema.safeParse({ maxCashierDiscountPercent: 101 }).success,
    ).toBe(false);
    expect(updateBusinessSettingsRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('precios por cantidad en el catálogo', () => {
  it('lee y escribe el formato del CSV', () => {
    expect(parsePriceTiers('24:650|12:700')).toEqual([
      { minQuantity: 12, unitPrice: 700 },
      { minQuantity: 24, unitPrice: 650 },
    ]);
    expect(parsePriceTiers('')).toEqual([]);
    expect(parsePriceTiers('doce a 700')).toBeNull();
    expect(formatPriceTiers([{ minQuantity: 12, unitPrice: 1_700 }])).toBe('12:1700');
  });

  it('exige cantidades crecientes y precios menores que el normal', () => {
    expect(
      priceTiersSchema.safeParse([
        { minQuantity: 12, unitPrice: 700 },
        { minQuantity: 12, unitPrice: 650 },
      ]).success,
    ).toBe(false);
    expect(priceTiersSchema.safeParse([{ minQuantity: 1, unitPrice: 700 }]).success).toBe(false);
    expect(priceTiersProblem(800, [{ minQuantity: 12, unitPrice: 800 }])).not.toBeNull();
    expect(
      priceTiersProblem(800, [
        { minQuantity: 12, unitPrice: 650 },
        { minQuantity: 24, unitPrice: 700 },
      ]),
    ).not.toBeNull();
    expect(priceTiersProblem(800, [{ minQuantity: 12, unitPrice: 700 }])).toBeNull();
  });
});
