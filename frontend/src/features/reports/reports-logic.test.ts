import { describe, expect, it } from 'vitest';
import { groupSales, presetRange, usedMethods, weekStart } from './reports-logic';

describe('reportes: agrupación y rangos', () => {
  it('agrupa por semana desde el lunes y por mes', () => {
    const byDay = [
      { date: '2026-10-05', total: 1_000, count: 1 },
      { date: '2026-10-11', total: 2_000, count: 2 },
      { date: '2026-10-12', total: 4_000, count: 1 },
    ];
    expect(weekStart('2026-10-11')).toBe('2026-10-05');
    expect(groupSales(byDay, 'week').map((row) => row.total)).toEqual([3_000, 4_000]);
    expect(groupSales(byDay, 'month')).toEqual([
      { key: '2026-10', label: 'oct 2026', total: 7_000, count: 4 },
    ]);
  });

  it('el mes pasado va del 1 al último día', () => {
    expect(presetRange('lastMonth', new Date('2026-10-06T15:00:00Z'))).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });
});

describe('reportes: medios de pago usados', () => {
  it('deja solo los que aparecen, en el orden dado', () => {
    const rows = [
      { byMethod: [{ method: 'NEQUI', amount: 1 }] },
      { byMethod: [{ method: 'CASH', amount: 2 }] },
    ];
    expect(usedMethods(rows, ['CASH', 'CARD', 'NEQUI'])).toEqual(['CASH', 'NEQUI']);
  });
});
