import type { Money } from '../money/money';

/** Billetes y monedas colombianas que se cuentan en el arqueo, de mayor a menor valor. */
export const DENOMINATIONS = [
  100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100, 50,
] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

export interface DenominationCount {
  denomination: Denomination;
  quantity: number;
}

export function isDenomination(value: number): value is Denomination {
  return (DENOMINATIONS as readonly number[]).includes(value);
}

/** Suma lo contado: cada denominación por su cantidad. */
export function countDenominations(counts: readonly DenominationCount[]): Money {
  return counts.reduce((sum, { denomination, quantity }) => sum + denomination * quantity, 0);
}

/**
 * Efectivo que debe haber en el cajón: la base más el efectivo cobrado, menos lo que salió
 * como egreso o retiro.
 */
export function expectedCashOf(parts: {
  openingAmount: Money;
  cashSales: Money;
  expenses: Money;
  withdrawals: Money;
}): Money {
  return parts.openingAmount + parts.cashSales - parts.expenses - parts.withdrawals;
}

/** Diferencia del arqueo: positiva = sobrante, negativa = faltante. */
export function cashDifference(counted: Money, expected: Money): Money {
  return counted - expected;
}
