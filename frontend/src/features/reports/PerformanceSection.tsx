import {
  formatCOP,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  performanceReportSchema,
  type PerformanceRow,
} from '@panesypan/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/surface';
import { apiJson } from '@/lib/api-client';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { downloadReport } from '../dashboard/dashboard.api';
import { usedMethods } from './reports-logic';

type View = 'shift' | 'day';

function getPerformance(from: string, to: string, signal?: AbortSignal) {
  return apiJson(`/api/v1/reports/performance?from=${from}&to=${to}`, performanceReportSchema, {
    signal,
  });
}

const money = (value: number | null): string => (value === null ? '—' : formatCOP(value));

/**
 * Desempeño en el rango: una fila por caja (vista detallada) o por día (consolidada), con
 * ventas por medio de pago, costo, utilidad bruta, movimientos, compras y el efectivo.
 */
export function PerformanceSection({ from, to }: { from: string; to: string }) {
  const [view, setView] = useState<View>('shift');
  const report = useQuery({
    queryKey: ['reports', 'performance', { from, to }],
    queryFn: ({ signal }) => getPerformance(from, to, signal),
  });
  const download = useMutation({
    mutationFn: () => downloadReport('performance', { from, to }),
    onSuccess: () => toast.success('Reporte descargado'),
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (report.isPending) return <Skeleton className="h-96" />;
  if (report.isError) {
    return (
      <ErrorState description={errorMessage(report.error)} onRetry={() => void report.refetch()} />
    );
  }
  const rows = view === 'shift' ? report.data.byShift : report.data.byDay;
  const methods = usedMethods(rows, PAYMENT_METHODS);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Desempeño</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Vista" className="inline-flex rounded-xl bg-muted p-1">
            {(
              [
                ['shift', 'Por caja'],
                ['day', 'Por día'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={view === value}
                onClick={() => {
                  setView(value);
                }}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-bold',
                  view === value ? 'bg-card shadow-sm' : 'text-muted-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            disabled={download.isPending}
            onClick={() => {
              download.mutate();
            }}
          >
            <Download aria-hidden="true" /> {download.isPending ? 'Descargando…' : 'CSV'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState title="No hay cajas en estas fechas" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="p-2">{view === 'shift' ? 'Caja' : 'Día'}</th>
                  {methods.map((method) => (
                    <th key={method} className="p-2 text-right">
                      {PAYMENT_METHOD_LABELS[method]}
                    </th>
                  ))}
                  <th className="p-2 text-right">Total</th>
                  <th className="p-2 text-right">Costo</th>
                  <th className="p-2 text-right">Utilidad bruta</th>
                  <th className="p-2 text-right">Ingresos</th>
                  <th className="p-2 text-right">Gastos</th>
                  <th className="p-2 text-right">Compras</th>
                  <th className="p-2 text-right">Autoconsumo</th>
                  <th className="p-2 text-right">Devoluciones</th>
                  <th className="p-2 text-right">Descuentos</th>
                  <th className="p-2 text-right">Caja inicial</th>
                  <th className="p-2 text-right">Caja final</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row: PerformanceRow) => (
                  <tr key={row.key}>
                    <td className="p-2 font-bold whitespace-nowrap">
                      {row.label}
                      {row.userName === null ? null : (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {row.userName} · {row.businessDate}
                        </span>
                      )}
                    </td>
                    {methods.map((method) => (
                      <td key={method} className="p-2 text-right">
                        {formatCOP(
                          row.byMethod.find((entry) => entry.method === method)?.amount ?? 0,
                        )}
                      </td>
                    ))}
                    <td className="p-2 text-right font-bold">{formatCOP(row.salesTotal)}</td>
                    <td className="p-2 text-right">{formatCOP(row.costOfSales)}</td>
                    <td className="p-2 text-right font-bold">{formatCOP(row.grossProfit)}</td>
                    <td className="p-2 text-right">{formatCOP(row.incomesTotal)}</td>
                    <td className="p-2 text-right">{formatCOP(row.expensesTotal)}</td>
                    <td className="p-2 text-right">{formatCOP(row.purchasesTotal)}</td>
                    <td className="p-2 text-right">{money(row.selfConsumptionValue)}</td>
                    <td className="p-2 text-right">{formatCOP(row.returnsTotal)}</td>
                    <td className="p-2 text-right">{formatCOP(row.discountsTotal)}</td>
                    <td className="p-2 text-right">{formatCOP(row.openingAmount)}</td>
                    <td className="p-2 text-right">{formatCOP(row.closingCash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {view === 'shift' ? (
          <p className="mt-3 text-xs text-muted-foreground">
            El autoconsumo y las compras que no se pagaron con una caja aparecen en la vista por
            día.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
