import { businessReportSchema, formatCOP, type BusinessReport } from '@panesypan/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorState, PageHeader } from '@/components/feedback';
import { Field, Input } from '@/components/ui/form';
import { Alert, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/surface';
import { apiJson } from '@/lib/api-client';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { ExportCard } from '../dashboard/ExportCard';
import { groupSales, presetRange, type Grouping, type Preset } from './reports-logic';

const PRESETS: readonly { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'week', label: 'Esta semana' },
  { value: 'month', label: 'Este mes' },
  { value: 'lastMonth', label: 'Mes pasado' },
];
const GROUPINGS: readonly { value: Grouping; label: string }[] = [
  { value: 'day', label: 'Por día' },
  { value: 'week', label: 'Por semana' },
  { value: 'month', label: 'Por mes' },
];

const compactCOP = new Intl.NumberFormat('es-CO', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

async function getBusinessReport(from: string, to: string, signal?: AbortSignal) {
  return apiJson(`/api/v1/reports/business?from=${from}&to=${to}`, businessReportSchema, {
    signal,
  });
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap rounded-xl bg-muted p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => {
            onChange(option.value);
          }}
          className={cn(
            'h-9 rounded-lg px-3 text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
            value === option.value ? 'bg-card shadow-xs' : 'text-muted-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Reporte del negocio: utilidad estimada, ventas, gastos, nómina, compras y pérdidas. */
export function ReportsPage() {
  const [preset, setPreset] = useState<Preset | null>('month');
  const [range, setRange] = useState(() => presetRange('month'));
  const [grouping, setGrouping] = useState<Grouping>('day');
  const valid = range.from !== '' && range.to !== '' && range.from <= range.to;
  const report = useQuery({
    queryKey: ['reports', 'business', range],
    queryFn: ({ signal }) => getBusinessReport(range.from, range.to, signal),
    enabled: valid,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Reportes"
        description="Cómo le fue al negocio en un rango de días: ventas, gastos, nómina, compras y la utilidad estimada."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Segmented
          label="Atajos de fechas"
          options={PRESETS}
          value={preset}
          onChange={(value) => {
            setPreset(value);
            setRange(presetRange(value));
          }}
        />
        <Field id="report-from" label="Desde">
          <Input
            id="report-from"
            type="date"
            value={range.from}
            onChange={(event) => {
              setPreset(null);
              setRange((current) => ({ ...current, from: event.target.value }));
            }}
          />
        </Field>
        <Field id="report-to" label="Hasta">
          <Input
            id="report-to"
            type="date"
            value={range.to}
            onChange={(event) => {
              setPreset(null);
              setRange((current) => ({ ...current, to: event.target.value }));
            }}
          />
        </Field>
      </div>

      {!valid ? (
        <Alert tone="danger">La fecha inicial no puede ser posterior a la final.</Alert>
      ) : report.isPending ? (
        <Skeleton className="h-96" />
      ) : report.isError ? (
        <ErrorState
          description={errorMessage(report.error)}
          onRetry={() => void report.refetch()}
        />
      ) : (
        <ReportBody report={report.data} grouping={grouping} onGrouping={setGrouping} />
      )}
      <div className="mt-6">
        <ExportCard />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  detail,
  strong = false,
}: {
  label: string;
  value: number;
  detail?: string;
  strong?: boolean;
}) {
  return (
    <Card className={cn('grid gap-1 p-4', strong && 'border-primary')}>
      <p className="text-sm font-bold text-muted-foreground">{label}</p>
      <p
        className={cn('text-2xl font-extrabold tabular-nums', strong && value < 0 && 'text-danger')}
      >
        {formatCOP(value)}
      </p>
      {detail === undefined ? null : <p className="text-sm text-muted-foreground">{detail}</p>}
    </Card>
  );
}

function ReportBody({
  report,
  grouping,
  onGrouping,
}: {
  report: BusinessReport;
  grouping: Grouping;
  onGrouping: (grouping: Grouping) => void;
}) {
  const otherCosts =
    report.expensesTotal + report.suppliesTotal + report.wasteValue + report.selfConsumptionValue;
  const periods = groupSales(report.byDay, grouping);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Ventas netas"
          value={report.netSales}
          detail={`${String(report.salesCount)} ventas${report.returnsTotal > 0 ? ` · devoluciones ${formatCOP(report.returnsTotal)}` : ''}`}
        />
        <Stat
          label="Costo de lo vendido"
          value={report.costOfSales}
          detail={
            report.unitsWithoutCost > 0
              ? `${String(report.unitsWithoutCost)} unidades sin costo no suman`
              : 'Con el costo actual de cada producto'
          }
        />
        <Stat
          label="Gastos"
          value={otherCosts}
          detail={`Egresos ${formatCOP(report.expensesTotal)} · insumos ${formatCOP(report.suppliesTotal)} · pérdidas ${formatCOP(report.wasteValue + report.selfConsumptionValue)}`}
        />
        <Stat
          label="Utilidad estimada"
          value={report.estimatedProfit}
          detail={`Sin contar retiros del dueño (${formatCOP(report.withdrawalsTotal)})`}
          strong
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Ventas</CardTitle>
          <Segmented
            label="Agrupar ventas"
            options={GROUPINGS}
            value={grouping}
            onChange={onGrouping}
          />
        </CardHeader>
        <CardContent>
          {periods.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay ventas en estas fechas.</p>
          ) : (
            <SalesTrendChart data={periods} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <TableCard
          title="Ventas por categoría"
          empty="Sin ventas."
          head={['Categoría', 'Unidades', 'Total']}
          rows={report.byCategory.map((row) => [
            row.name,
            String(row.quantity),
            formatCOP(row.total),
          ])}
        />
        <TableCard
          title="Ventas por producto"
          empty="Sin ventas."
          head={['Producto', 'Unidades', 'Total']}
          rows={report.byProduct.map((row) => [
            row.name,
            String(row.quantity),
            formatCOP(row.total),
          ])}
          scroll
        />
        <TableCard
          title="Gastos por tipo"
          empty="Sin egresos."
          head={['Tipo', 'Veces', 'Total']}
          rows={report.expensesByConcept.map((row) => [
            row.name,
            String(row.count),
            formatCOP(row.amount),
          ])}
        />
        <TableCard
          title="Nómina por persona"
          empty="Sin pagos de nómina."
          head={['Persona', 'Pagos', 'Total']}
          rows={report.payrollByStaff.map((row) => [
            row.name,
            String(row.count),
            formatCOP(row.amount),
          ])}
        />
        <TableCard
          title="Compras por proveedor"
          empty="Sin compras."
          head={['Proveedor', 'Compras', 'Total']}
          rows={report.purchasesBySupplier.map((row) => [
            row.name,
            String(row.count),
            formatCOP(row.amount),
          ])}
        />
        <TableCard
          title="Mermas y autoconsumo (al costo)"
          empty="Sin mermas ni autoconsumo."
          head={['Producto', 'Merma', 'Autoconsumo', 'Valor']}
          rows={report.lossesByProduct.map((row) => [
            row.name,
            String(row.wasted),
            String(row.consumed),
            formatCOP(row.value),
          ])}
        />
      </div>

      <p className="rounded-2xl bg-muted px-4 py-3 text-sm">
        <strong>Inventario valorizado hoy:</strong> {formatCOP(report.stockValue)} · ingresos de
        caja que no son ventas en el rango: {formatCOP(report.incomesTotal)}. La utilidad es
        estimada: usa el costo actual de cada producto; las compras de productos ya van en el costo
        de lo vendido y no se cuentan otra vez como gasto.
      </p>
    </div>
  );
}

function TableCard({
  title,
  head,
  rows,
  empty,
  scroll = false,
}: {
  title: string;
  head: readonly string[];
  rows: readonly ReactNode[][];
  empty: string;
  scroll?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className={cn(scroll && 'max-h-80 overflow-y-auto')}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                {head.map((cell, index) => (
                  <th key={cell} className={cn('pb-2 font-bold', index > 0 && 'text-right')}>
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      className={cn(
                        'py-1.5',
                        index > 0 && 'text-right tabular-nums',
                        index === 0 && 'font-bold',
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

interface PeriodRow {
  label: string;
  total: number;
  count: number;
}

function PeriodTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: PeriodRow }[];
}) {
  const row = payload?.[0]?.payload;
  if (active !== true || row === undefined) return null;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-md">
      <p className="font-extrabold">{row.label}</p>
      <p className="text-foreground">{formatCOP(row.total)}</p>
      <p className="text-muted-foreground">
        {row.count} {row.count === 1 ? 'venta' : 'ventas'}
      </p>
    </div>
  );
}

/** Comparativo de ventas: una sola serie (el título la nombra), sin leyenda. */
function SalesTrendChart({ data }: { data: readonly PeriodRow[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="Gráfico de ventas por período">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
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
          <Tooltip content={<PeriodTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.6 }} />
          <Bar
            dataKey="total"
            fill="var(--primary)"
            radius={[4, 4, 0, 0]}
            maxBarSize={36}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
