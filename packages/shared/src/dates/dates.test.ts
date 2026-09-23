import { describe, expect, it } from 'vitest';
import { formatDateTimeCO, isBusinessDate, toBusinessDate } from './dates';

describe('toBusinessDate', () => {
  it('usa la hora de Colombia (UTC-5) para decidir el día', () => {
    // 23:59:59 del 22 de septiembre en Bogotá
    expect(toBusinessDate(new Date('2026-09-23T04:59:59Z'))).toBe('2026-09-22');
    // 00:00:00 del 23 de septiembre en Bogotá
    expect(toBusinessDate(new Date('2026-09-23T05:00:00Z'))).toBe('2026-09-23');
  });

  it('funciona en cambios de año', () => {
    expect(toBusinessDate(new Date('2027-01-01T04:00:00Z'))).toBe('2026-12-31');
  });

  it('rechaza fechas inválidas', () => {
    expect(() => toBusinessDate(new Date('no-es-fecha'))).toThrow(RangeError);
  });
});

describe('isBusinessDate', () => {
  it('valida el formato AAAA-MM-DD', () => {
    expect(isBusinessDate('2026-09-23')).toBe(true);
    expect(isBusinessDate('2026-13-01')).toBe(false);
    expect(isBusinessDate('23/09/2026')).toBe(false);
  });
});

describe('formatDateTimeCO', () => {
  it('muestra la fecha y hora en formato colombiano', () => {
    // Según la versión de ICU los espacios pueden ser normales o no separables.
    const formatted = formatDateTimeCO(new Date('2026-09-23T15:30:00Z')).replace(/\s/g, ' ');
    expect(formatted).toBe('23/09/2026, 10:30 a. m.');
  });
});
