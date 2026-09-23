import { describe, expect, it } from 'vitest';
import {
  businessDateRangeUtc,
  formatDateTimeCO,
  formatLongDateCO,
  isBusinessDate,
  toBusinessDate,
} from './dates';

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

describe('businessDateRangeUtc', () => {
  it('cubre el día completo en hora de Colombia', () => {
    const { start, end } = businessDateRangeUtc('2026-09-23');
    expect(start.toISOString()).toBe('2026-09-23T05:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-24T05:00:00.000Z');
    expect(toBusinessDate(start)).toBe('2026-09-23');
    expect(toBusinessDate(new Date(end.getTime() - 1))).toBe('2026-09-23');
  });

  it('rechaza fechas imposibles', () => {
    expect(() => businessDateRangeUtc('2026-02-31')).toThrow(RangeError);
    expect(() => businessDateRangeUtc('23/09/2026')).toThrow(RangeError);
  });
});

describe('isBusinessDate', () => {
  it('valida el formato AAAA-MM-DD', () => {
    expect(isBusinessDate('2026-09-23')).toBe(true);
    expect(isBusinessDate('2026-13-01')).toBe(false);
    expect(isBusinessDate('23/09/2026')).toBe(false);
  });
});

describe('formatLongDateCO', () => {
  it('muestra el día de la semana y el mes en hora de Colombia', () => {
    expect(formatLongDateCO(new Date('2026-09-23T15:00:00Z'))).toBe('Miércoles, 23 de septiembre');
    // 11 p. m. del 22 en Colombia, aunque en UTC ya es 23
    expect(formatLongDateCO(new Date('2026-09-23T04:00:00Z'))).toBe('Martes, 22 de septiembre');
  });
});

describe('formatDateTimeCO', () => {
  it('muestra la fecha y hora en formato colombiano', () => {
    // Según la versión de ICU los espacios pueden ser normales o no separables.
    const formatted = formatDateTimeCO(new Date('2026-09-23T15:30:00Z')).replace(/\s/g, ' ');
    expect(formatted).toBe('23/09/2026, 10:30 a. m.');
  });
});
