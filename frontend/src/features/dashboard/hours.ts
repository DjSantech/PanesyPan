import type { DashboardSummary } from '@panesypan/shared';

type HourRow = DashboardSummary['byHour'][number];

/** Horario habitual de la panadería: fuera de él solo se muestran las horas con ventas. */
const DEFAULT_FIRST_HOUR = 5;
const DEFAULT_LAST_HOUR = 20;

export const formatHour = (hour: number): string => {
  const suffix = hour < 12 ? 'a. m.' : 'p. m.';
  return `${String(hour % 12 === 0 ? 12 : hour % 12)} ${suffix}`;
};

/** Recorta las 24 horas a la franja que interesa. */
export function visibleHours(byHour: readonly HourRow[]): HourRow[] {
  const withSales = byHour.filter((row) => row.count > 0).map((row) => row.hour);
  const first = Math.min(DEFAULT_FIRST_HOUR, ...withSales);
  const last = Math.max(DEFAULT_LAST_HOUR, ...withSales);
  return byHour.filter((row) => row.hour >= first && row.hour <= last);
}
