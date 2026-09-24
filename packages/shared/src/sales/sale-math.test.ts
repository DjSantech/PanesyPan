import { describe, expect, it } from 'vitest';
import {
  computeSaleTotals,
  discountNeedsApproval,
  discountProblem,
  settlePayments,
  suggestedCashAmounts,
} from './sale-math';

const lines = [
  { unitPrice: 2_500, quantity: 3 },
  { unitPrice: 4_000, quantity: 1 },
];

describe('computeSaleTotals', () => {
  it('suma las líneas sin descuento', () => {
    expect(computeSaleTotals(lines, null)).toEqual({
      subtotal: 11_500,
      discount: 0,
      total: 11_500,
    });
  });

  it('aplica un porcentaje redondeando al peso', () => {
    // 15 % de 11.500 = 1.725
    expect(computeSaleTotals(lines, { mode: 'PERCENT', value: 15 })).toEqual({
      subtotal: 11_500,
      discount: 1_725,
      total: 9_775,
    });
    // 10 % de 3.333 = 333,3 → 333
    expect(
      computeSaleTotals([{ unitPrice: 3_333, quantity: 1 }], { mode: 'PERCENT', value: 10 }),
    ).toMatchObject({ discount: 333, total: 3_000 });
  });

  it('aplica un valor fijo', () => {
    expect(computeSaleTotals(lines, { mode: 'AMOUNT', value: 1_500 }).total).toBe(10_000);
  });

  it('rechaza cantidades inválidas', () => {
    expect(() => computeSaleTotals([{ unitPrice: 1_000, quantity: 0 }], null)).toThrow(RangeError);
    expect(() => computeSaleTotals([{ unitPrice: 1_000, quantity: 1.5 }], null)).toThrow(
      RangeError,
    );
  });
});

describe('descuentos', () => {
  it('no permite dejar la venta en cero', () => {
    expect(discountProblem({ subtotal: 5_000, discount: 5_000, total: 0 })).not.toBeNull();
    expect(discountProblem({ subtotal: 5_000, discount: 500, total: 4_500 })).toBeNull();
  });

  it('pide autorización solo por encima del tope', () => {
    const tenPercent = { subtotal: 10_000, discount: 1_000, total: 9_000 };
    expect(discountNeedsApproval(tenPercent, 10)).toBe(false);
    expect(discountNeedsApproval({ ...tenPercent, discount: 1_001 }, 10)).toBe(true);
    expect(discountNeedsApproval(tenPercent, 0)).toBe(true);
  });
});

describe('settlePayments', () => {
  it('calcula el cambio del efectivo', () => {
    expect(settlePayments(12_500, [{ method: 'CASH', amount: 12_500 }], 20_000)).toEqual({
      ok: true,
      change: 7_500,
      cashReceived: 20_000,
    });
  });

  it('asume pago exacto si no se indica lo recibido', () => {
    expect(settlePayments(8_000, [{ method: 'CASH', amount: 8_000 }], null)).toEqual({
      ok: true,
      change: 0,
      cashReceived: 8_000,
    });
  });

  it('combina medios de pago y el cambio sale solo del efectivo', () => {
    const result = settlePayments(
      30_000,
      [
        { method: 'NEQUI', amount: 20_000 },
        { method: 'CASH', amount: 10_000 },
      ],
      50_000,
    );
    expect(result).toEqual({ ok: true, change: 40_000, cashReceived: 50_000 });
  });

  it('ignora lo recibido cuando no hay efectivo', () => {
    expect(settlePayments(5_000, [{ method: 'DEBIT_CARD', amount: 5_000 }], 10_000)).toEqual({
      ok: true,
      change: 0,
      cashReceived: null,
    });
  });

  it('rechaza pagos que no cuadran', () => {
    expect(settlePayments(10_000, [{ method: 'NEQUI', amount: 9_000 }], null).ok).toBe(false);
    expect(settlePayments(10_000, [{ method: 'NEQUI', amount: 11_000 }], null).ok).toBe(false);
    expect(settlePayments(10_000, [], null).ok).toBe(false);
    expect(
      settlePayments(
        10_000,
        [
          { method: 'CASH', amount: 5_000 },
          { method: 'CASH', amount: 5_000 },
        ],
        null,
      ).ok,
    ).toBe(false);
    expect(settlePayments(10_000, [{ method: 'CASH', amount: 10_000 }], 5_000).ok).toBe(false);
  });
});

describe('suggestedCashAmounts', () => {
  it('propone el valor exacto y billetes redondos', () => {
    expect(suggestedCashAmounts(12_500)).toEqual([12_500, 13_000, 15_000, 20_000, 50_000]);
    expect(suggestedCashAmounts(20_000)).toEqual([20_000, 50_000, 100_000]);
    expect(suggestedCashAmounts(0)).toEqual([]);
  });
});
