import { describe, expect, it } from 'vitest';
import {
  cashDifference,
  countDenominations,
  DENOMINATIONS,
  expectedCashOf,
  isDenomination,
} from './cash-math';

describe('arqueo de caja', () => {
  it('suma cada denominación por su cantidad', () => {
    expect(
      countDenominations([
        { denomination: 50_000, quantity: 2 },
        { denomination: 2_000, quantity: 3 },
        { denomination: 500, quantity: 1 },
      ]),
    ).toBe(106_500);
    expect(countDenominations([])).toBe(0);
  });

  it('las denominaciones van de mayor a menor y solo se aceptan las conocidas', () => {
    expect([...DENOMINATIONS]).toEqual([...DENOMINATIONS].sort((a, b) => b - a));
    expect(isDenomination(20_000)).toBe(true);
    expect(isDenomination(3_000)).toBe(false);
  });

  it('calcula el efectivo esperado y la diferencia', () => {
    const expected = expectedCashOf({
      openingAmount: 100_000,
      cashSales: 80_000,
      expenses: 15_000,
      withdrawals: 50_000,
    });
    expect(expected).toBe(115_000);
    expect(cashDifference(110_000, expected)).toBe(-5_000);
    expect(cashDifference(120_000, expected)).toBe(5_000);
    expect(cashDifference(115_000, expected)).toBe(0);
  });
});
