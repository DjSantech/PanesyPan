import { describe, expect, it } from 'vitest';
import { nitCheckDigit, onlyDigits } from './nit';
import { allocateDiscount, splitTaxIncluded } from './tax';

describe('splitTaxIncluded', () => {
  it('separa base e impuesto y suman exactamente el valor', () => {
    expect(splitTaxIncluded(11_900, 19)).toEqual({ base: 10_000, tax: 1_900 });
    expect(splitTaxIncluded(2_000, 19)).toEqual({ base: 1_680.67, tax: 319.33 });
    expect(splitTaxIncluded(1_080, 8)).toEqual({ base: 1_000, tax: 80 });
  });

  it('sin tarifa todo es base', () => {
    expect(splitTaxIncluded(2_500, 0)).toEqual({ base: 2_500, tax: 0 });
  });

  it('base + impuesto nunca pierde centavos', () => {
    for (const gross of [800, 1_500, 2_000, 3_000, 14_000, 99_999]) {
      for (const rate of [5, 8, 19]) {
        const { base, tax } = splitTaxIncluded(gross, rate);
        expect(Math.round((base + tax) * 100)).toBe(gross * 100);
      }
    }
  });
});

describe('allocateDiscount', () => {
  it('reparte en proporción y la suma es exacta', () => {
    expect(allocateDiscount([4_000, 3_000], 1_000)).toEqual([571, 429]);
    expect(allocateDiscount([1_000, 1_000, 1_000], 100)).toEqual([34, 33, 33]);
    const parts = allocateDiscount([800, 2_000, 14_000, 3_000], 1_987);
    expect(parts.reduce((sum, part) => sum + part, 0)).toBe(1_987);
  });

  it('sin descuento o sin valor, nada', () => {
    expect(allocateDiscount([1_000], 0)).toEqual([0]);
    expect(allocateDiscount([0, 0], 500)).toEqual([0, 0]);
  });

  it('un descuento total deja cada línea en cero', () => {
    expect(allocateDiscount([1_000, 500], 1_500)).toEqual([1_000, 500]);
  });
});

describe('nitCheckDigit', () => {
  it('calcula el DV con el algoritmo de la DIAN', () => {
    expect(nitCheckDigit('800197268')).toBe(4); // NIT de la DIAN
    expect(nitCheckDigit('900123456')).toBe(8);
    expect(nitCheckDigit('1')).toBe(8);
  });

  it('rechaza lo que no es un número', () => {
    expect(nitCheckDigit('')).toBeNull();
    expect(nitCheckDigit('90012345A')).toBeNull();
    expect(nitCheckDigit('1234567890123456')).toBeNull();
  });

  it('limpia puntos y guiones', () => {
    expect(onlyDigits('900.123.456-8')).toBe('9001234568');
  });
});
