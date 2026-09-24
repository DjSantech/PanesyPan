import { formatCOP, type DashboardSummary } from '@panesypan/shared';
import { formatHour, visibleHours } from './hours';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type HourRow = DashboardSummary['byHour'][number];

const compactCOP = new Intl.NumberFormat('es-CO', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

interface TooltipProps {
  active?: boolean;
  payload?: { payload: HourRow }[];
}

function HourTooltip({ active, payload }: TooltipProps) {
  const row = payload?.[0]?.payload;
  if (active !== true || row === undefined) return null;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-md">
      <p className="font-extrabold">{formatHour(row.hour)}</p>
      <p className="text-foreground">{formatCOP(row.total)}</p>
      <p className="text-muted-foreground">
        {row.count} {row.count === 1 ? 'venta' : 'ventas'}
      </p>
    </div>
  );
}

/** Ventas por hora: una sola serie, un solo color y sin leyenda (el título ya la nombra). */
export function SalesByHourChart({ byHour }: { byHour: readonly HourRow[] }) {
  const data = visibleHours(byHour);
  return (
    <div className="h-64 w-full" role="img" aria-label="Gráfico de ventas por hora del día">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="hour"
            tickFormatter={(hour: number) => String(hour)}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => compactCOP.format(value)}
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          />
          <Tooltip content={<HourTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.6 }} />
          <Bar
            dataKey="total"
            fill="var(--primary)"
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
