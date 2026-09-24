import { describe, expect, it } from 'vitest';
import {
  formatCOP,
  isMoney,
  parseCOPInput,
  percentageOf,
  splitTaxIncludedAmount,
  sumMoney,
} from './money';

/** Espacio no separable que usa Intl entre el signo $ y el número. */
const NBSP = String.fromCharCode(0xa0);

describe('formatCOP', () => {
  it('formatea pesos con separador de miles y sin decimales', () => {
    expect(formatCOP(12_500)).toBe(`$${NBSP}12.500`);
    expect(formatCOP(1_500)).toBe(`$${NBSP}1.500`);
    expect(formatCOP(1_234_567)).toBe(`$${NBSP}1.234.567`);
    expect(formatCOP(0)).toBe(`$${NBSP}0`);
  });

  it('formatea montos negativos (faltantes de caja)', () => {
    expect(formatCOP(-12_500)).toBe(`-$${NBSP}12.500`);
  });

  it('rechaza montos con decimales', () => {
    expect(() => formatCOP(12_500.5)).toThrow(RangeError);
    expect(() => formatCOP(Number.NaN)).toThrow(RangeError);
  });
});

describe('isMoney', () => {
  it('solo acepta enteros seguros', () => {
    expect(isMoney(1000)).toBe(true);
    expect(isMoney(-50)).toBe(true);
    expect(isMoney(10.5)).toBe(false);
    expect(isMoney('1000')).toBe(false);
    expect(isMoney(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});

describe('sumMoney', () => {
  it('suma enteros', () => {
    expect(sumMoney([2_000, 3_500, 500])).toBe(6_000);
    expect(sumMoney([])).toBe(0);
  });

  it('rechaza valores no enteros', () => {
    expect(() => sumMoney([1_000, 0.1])).toThrow(RangeError);
  });
});

describe('percentageOf', () => {
  it('calcula porcentajes en puntos básicos con redondeo al peso', () => {
    expect(percentageOf(10_000, 1_000)).toBe(1_000); // 10 %
    expect(percentageOf(12_345, 1_000)).toBe(1_235); // 1.234,5 → 1.235
    expect(percentageOf(12_344, 1_000)).toBe(1_234); // 1.234,4 → 1.234
    expect(percentageOf(5_000, 0)).toBe(0);
  });

  it('rechaza tasas o montos inválidos', () => {
    expect(() => percentageOf(1_000, -1)).toThrow(RangeError);
    expect(() => percentageOf(1_000, 12.5)).toThrow(RangeError);
    expect(() => percentageOf(-1_000, 100)).toThrow(RangeError);
  });
});

describe('splitTaxIncludedAmount', () => {
  it('desglosa un precio con impuesto incluido', () => {
    expect(splitTaxIncludedAmount(10_800, 800)).toEqual({ base: 10_000, tax: 800 });
    expect(splitTaxIncludedAmount(11_900, 1_900)).toEqual({ base: 10_000, tax: 1_900 });
  });

  it('redondea la base y el impuesto siempre suma exactamente el total', () => {
    const { base, tax } = splitTaxIncludedAmount(5_000, 800);
    expect(base).toBe(4_630); // 4.629,63 → 4.630
    expect(tax).toBe(370);
    expect(base + tax).toBe(5_000);
  });

  it('mantiene la suma exacta para muchos precios', () => {
    for (let total = 0; total <= 200_000; total += 50) {
      for (const rate of [0, 500, 800, 1_900]) {
        const { base, tax } = splitTaxIncludedAmount(total, rate);
        expect(base + tax).toBe(total);
        expect(Number.isSafeInteger(base) && Number.isSafeInteger(tax)).toBe(true);
        expect(tax).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('sin impuesto la base es el total', () => {
    expect(splitTaxIncludedAmount(3_500, 0)).toEqual({ base: 3_500, tax: 0 });
  });
});

describe('parseCOPInput', () => {
  it('lee precios escritos de varias formas', () => {
    expect(parseCOPInput('12.500')).toBe(12_500);
    expect(parseCOPInput('$ 12.500')).toBe(12_500);
    expect(parseCOPInput('800')).toBe(800);
    expect(parseCOPInput('')).toBeNull();
    expect(parseCOPInput('abc')).toBeNull();
  });
});
