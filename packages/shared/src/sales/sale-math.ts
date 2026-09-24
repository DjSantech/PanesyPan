import type { PaymentMethod } from '../constants/payment-methods';
import { formatCOP, percentageOf, sumMoney, type Money } from '../money/money';

/**
 * Cálculos de una venta. Los usa la API (que es la que decide) y el punto de venta
 * (para mostrar el total y el cambio mientras la cajera cobra). Todo en pesos enteros.
 */

export const DISCOUNT_MODES = ['PERCENT', 'AMOUNT'] as const;
export type DiscountMode = (typeof DISCOUNT_MODES)[number];

export interface PricedLine {
  unitPrice: Money;
  quantity: number;
}

export interface DiscountValue {
  mode: DiscountMode;
  /** PERCENT: porcentaje entero (10 = 10 %). AMOUNT: pesos. */
  value: number;
}

export interface SaleTotals {
  subtotal: Money;
  discount: Money;
  total: Money;
}

export function lineTotal(line: PricedLine): Money {
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
    throw new RangeError(`Cantidad inválida: ${String(line.quantity)}`);
  }
  return sumMoney([line.unitPrice * line.quantity]);
}

/** Valor del descuento en pesos. El porcentaje se redondea al peso más cercano. */
export function discountAmount(subtotal: Money, discount: DiscountValue | null): Money {
  if (discount === null) return 0;
  return discount.mode === 'PERCENT'
    ? percentageOf(subtotal, discount.value * 100)
    : discount.value;
}

export function computeSaleTotals(
  lines: readonly PricedLine[],
  discount: DiscountValue | null,
): SaleTotals {
  const subtotal = sumMoney(lines.map(lineTotal));
  const discountValue = discountAmount(subtotal, discount);
  return { subtotal, discount: discountValue, total: subtotal - discountValue };
}

/** Motivo por el que el descuento no es válido, o `null` si se puede aplicar. */
export function discountProblem(totals: SaleTotals): string | null {
  if (totals.discount <= 0) return null;
  if (totals.discount >= totals.subtotal) return 'El descuento no puede dejar la venta en $ 0';
  return null;
}

/** ¿El descuento supera el tope que la cajera puede dar sin el PIN de un administrador? */
export function discountNeedsApproval(totals: SaleTotals, maxPercent: number): boolean {
  return totals.discount * 100 > totals.subtotal * maxPercent;
}

export interface PaymentValue {
  method: PaymentMethod;
  amount: Money;
}

export type PaymentSettlement =
  { ok: true; change: Money; cashReceived: Money | null } | { ok: false; message: string };

/**
 * Valida los pagos de una venta (se permite combinar medios) y calcula el cambio.
 * `amount` es lo que se abona con cada medio; `cashReceived` es el billete que entrega el
 * cliente para la parte en efectivo (si no se indica, se asume que pagó exacto).
 */
export function settlePayments(
  total: Money,
  payments: readonly PaymentValue[],
  cashReceived: Money | null,
): PaymentSettlement {
  if (payments.length === 0) return { ok: false, message: 'Agrega al menos un medio de pago' };
  const methods = new Set(payments.map((payment) => payment.method));
  if (methods.size !== payments.length) {
    return { ok: false, message: 'Cada medio de pago se usa una sola vez' };
  }
  if (payments.some((payment) => !Number.isSafeInteger(payment.amount) || payment.amount <= 0)) {
    return { ok: false, message: 'Cada pago debe ser mayor que $ 0' };
  }
  const paid = sumMoney(payments.map((payment) => payment.amount));
  if (paid !== total) {
    return {
      ok: false,
      message: `Los pagos suman ${formatCOP(paid)} y el total es ${formatCOP(total)}`,
    };
  }

  const cash = payments.find((payment) => payment.method === 'CASH')?.amount ?? 0;
  if (cash === 0) return { ok: true, change: 0, cashReceived: null };
  const received = cashReceived ?? cash;
  if (received < cash) {
    return {
      ok: false,
      message: `El efectivo recibido (${formatCOP(received)}) no alcanza para ${formatCOP(cash)}`,
    };
  }
  return { ok: true, change: received - cash, cashReceived: received };
}

/** Valores a los que se redondea el pago en efectivo (sumas redondas y billetes grandes). */
const CASH_STEPS: readonly Money[] = [1_000, 5_000, 10_000, 20_000, 50_000, 100_000];

/**
 * Botones rápidos de efectivo: el valor exacto y los billetes (o sumas redondas) con los que
 * el cliente suele pagar. Ejemplo: 12.500 → 12.500 · 13.000 · 15.000 · 20.000 · 50.000.
 */
export function suggestedCashAmounts(total: Money, max = 5): Money[] {
  if (total <= 0) return [];
  const options = new Set<Money>([total]);
  for (const step of CASH_STEPS) {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total) options.add(rounded);
  }
  return [...options].sort((a, b) => a - b).slice(0, max);
}
