import { toBusinessDate, type BusinessReport } from '@panesypan/shared';

export type Grouping = 'day' | 'week' | 'month';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const parse = (date: string): Date => new Date(`${date}T12:00:00Z`);
const iso = (date: Date): string => date.toISOString().slice(0, 10);

/** Lunes de la semana de una fecha AAAA-MM-DD. */
export function weekStart(date: string): string {
  const day = parse(date);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return iso(day);
}

/** Etiqueta corta del período: "6 oct", "sem. 6 oct", "oct 2026". */
export function periodLabel(key: string, grouping: Grouping): string {
  if (grouping === 'month') {
    const [year, month] = key.split('-');
    return `${MONTHS[Number(month) - 1] ?? ''} ${year ?? ''}`;
  }
  const day = parse(key);
  const label = `${String(day.getUTCDate())} ${MONTHS[day.getUTCMonth()] ?? ''}`;
  return grouping === 'week' ? `sem. ${label}` : label;
}

/** Agrupa las ventas por día, semana (desde el lunes) o mes. */
export function groupSales(
  byDay: BusinessReport['byDay'],
  grouping: Grouping,
): { key: string; label: string; total: number; count: number }[] {
  const groups = new Map<string, { total: number; count: number }>();
  for (const row of byDay) {
    const key =
      grouping === 'day'
        ? row.date
        : grouping === 'week'
          ? weekStart(row.date)
          : row.date.slice(0, 7);
    const current = groups.get(key) ?? { total: 0, count: 0 };
    groups.set(key, { total: current.total + row.total, count: current.count + row.count });
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, row]) => ({ key, label: periodLabel(key, grouping), ...row }));
}

export type Preset = 'today' | 'week' | 'month' | 'lastMonth';

/** Rango de fechas de los atajos (hoy, esta semana, este mes, el mes pasado). */
export function presetRange(preset: Preset, now = new Date()): { from: string; to: string } {
  const today = toBusinessDate(now);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') return { from: weekStart(today), to: today };
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  const firstOfMonth = parse(`${today.slice(0, 8)}01`);
  firstOfMonth.setUTCDate(0);
  const lastMonthEnd = iso(firstOfMonth);
  return { from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd };
}
