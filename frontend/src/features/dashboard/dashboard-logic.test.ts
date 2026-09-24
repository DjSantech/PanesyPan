import type { DashboardSummary } from '@panesypan/shared';
import { describe, expect, it } from 'vitest';
import { formatHour, visibleHours } from './hours';

type HourRow = DashboardSummary['byHour'][number];

const day = (sales: Record<number, number> = {}): HourRow[] =>
  Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: sales[hour] === undefined ? 0 : 1,
    total: sales[hour] ?? 0,
  }));

describe('formatHour', () => {
  it('usa el formato de 12 horas de Colombia', () => {
    expect(formatHour(0)).toBe('12 a. m.');
    expect(formatHour(7)).toBe('7 a. m.');
    expect(formatHour(12)).toBe('12 p. m.');
    expect(formatHour(18)).toBe('6 p. m.');
  });
});

describe('visibleHours', () => {
  it('muestra el horario habitual (5 a. m. a 8 p. m.) cuando no hay ventas fuera de él', () => {
    const hours = visibleHours(day({ 8: 5_000 })).map((row) => row.hour);
    expect(hours[0]).toBe(5);
    expect(hours.at(-1)).toBe(20);
  });

  it('amplía la franja si hubo ventas fuera del horario', () => {
    const hours = visibleHours(day({ 3: 2_000, 22: 4_000 })).map((row) => row.hour);
    expect(hours[0]).toBe(3);
    expect(hours.at(-1)).toBe(22);
  });
});
