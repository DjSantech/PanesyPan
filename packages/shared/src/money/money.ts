import { BUSINESS_CURRENCY, BUSINESS_LOCALE } from '../constants/business';

/**
 * Monto en pesos colombianos (COP), siempre entero. Nunca se usan decimales para dinero:
 * todos los cálculos se hacen con enteros y el redondeo es explícito.
 */
export type Money = number;

/** Escala de los puntos básicos: 10.000 pb = 100 %, 800 pb = 8 %. */
export const BASIS_POINTS_SCALE = 10_000;

const copFormatter = new Intl.NumberFormat(BUSINESS_LOCALE, {
  style: 'currency',
  currency: BUSINESS_CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
  useGrouping: 'always',
});

export function isMoney(value: unknown): value is Money {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertMoney(value: number, label = 'monto'): asserts value is Money {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`El ${label} debe ser un entero en pesos (recibido: ${String(value)})`);
  }
}

function assertNonNegativeMoney(value: number, label: string): void {
  assertMoney(value, label);
  if (value < 0) {
    throw new RangeError(`El ${label} no puede ser negativo (recibido: ${String(value)})`);
  }
}

function assertBasisPoints(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `La tasa debe ser un entero de puntos básicos ≥ 0 (recibido: ${String(value)})`,
    );
  }
}

/** División entera con redondeo al entero más cercano (0,5 hacia arriba). Solo para valores ≥ 0. */
function divideRoundHalfUp(numerator: number, denominator: number): number {
  let quotient = Math.floor(numerator / denominator);
  let remainder = numerator - quotient * denominator;
  // Corrige un posible error de coma flotante en la división de números muy grandes.
  if (remainder < 0) {
    quotient -= 1;
    remainder += denominator;
  } else if (remainder >= denominator) {
    quotient += 1;
    remainder -= denominator;
  }
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

/** Formatea un monto en pesos: 12500 → "$ 12.500" (con espacio no separable). */
export function formatCOP(amount: Money): string {
  assertMoney(amount);
  return copFormatter.format(amount);
}

/** Suma montos validando que todos sean enteros. */
export function sumMoney(amounts: readonly Money[]): Money {
  let total = 0;
  for (const amount of amounts) {
    assertMoney(amount);
    total += amount;
  }
  assertMoney(total, 'total');
  return total;
}

/** Calcula un porcentaje (en puntos básicos) de un monto, redondeado al peso más cercano. */
export function percentageOf(amount: Money, basisPoints: number): Money {
  assertNonNegativeMoney(amount, 'monto');
  assertBasisPoints(basisPoints);
  return divideRoundHalfUp(amount * basisPoints, BASIS_POINTS_SCALE);
}

export interface TaxBreakdown {
  /** Base gravable (precio sin impuesto). */
  base: Money;
  /** Valor del impuesto incluido en el precio. */
  tax: Money;
}

/**
 * Desglosa un precio que YA incluye el impuesto (así se manejan los precios de venta).
 * Ejemplo: 10.800 con 8 % (800 pb) → base 10.000 e impuesto 800.
 * base + tax siempre es exactamente igual al total.
 */
export function splitTaxIncludedAmount(total: Money, rateBasisPoints: number): TaxBreakdown {
  assertNonNegativeMoney(total, 'total');
  assertBasisPoints(rateBasisPoints);
  if (rateBasisPoints === 0) {
    return { base: total, tax: 0 };
  }
  const base = divideRoundHalfUp(total * BASIS_POINTS_SCALE, BASIS_POINTS_SCALE + rateBasisPoints);
  return { base, tax: total - base };
}
