import {
  formatCOP,
  formatTimeCO,
  PAYMENT_METHOD_LABELS,
  type DashboardSummary,
} from '@panesypan/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  Banknote,
  Receipt,
  ShoppingBag,
  Store,
  TrendingDown,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, type ReactNode } from 'react';
import { EmptyState, ErrorState } from '@/components/feedback';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/surface';
import { cn } from '@/lib/utils';
import { dashboardKeys, getDashboard } from './dashboard.api';
import { ExportCard } from './ExportCard';
import { formatHour, visibleHours } from './hours';
import { SalesByHourChart } from './SalesByHourChart';
import { FALLBACK_POLL_MS, useDashboardRealtime, type RealtimeStatus } from './use-realtime';

const STATUS_LABEL: Record<RealtimeStatus, string> = {
  connecting: 'Conectando…',
  live: 'En vivo',
  offline: 'Sin conexión en vivo',
};

function LiveBadge({ status }: { status: RealtimeStatus }) {
  return (
    <Badge tone={status === 'live' ? 'success' : status === 'offline' ? 'pending' : 'neutral'}>
      {status === 'offline' ? <WifiOff aria-hidden="true" /> : <Wifi aria-hidden="true" />}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'primary',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: ReactNode;
  tone?: 'primary' | 'danger';
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <span
          className={cn(
            'grid size-11 shrink-0 place-items-center rounded-2xl',
            tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-primary/12 text-primary',
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="grid min-w-0 gap-0.5">
          <p className="text-sm font-bold text-muted-foreground">{label}</p>
          <p className="text-2xl leading-tight font-extrabold">{value}</p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Barra horizontal proporcional al mayor valor: un solo tono, el nombre y el valor van en texto. */
function ShareRow({
  label,
  value,
  detail,
  max,
}: {
  label: string;
  value: number;
  detail: string;
  max: number;
}) {
  return (
    <li className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-bold">{label}</span>
        <span className="font-extrabold">{formatCOP(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className="h-full rounded-full bg-primary"
          style={{
            width: `${String(max === 0 ? 0 : Math.max(2, Math.round((value / max) * 100)))}%`,
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </li>
  );
}

const countLabel = (count: number): string =>
  count === 0 ? 'Aún sin ventas' : `${String(count)} ${count === 1 ? 'venta' : 'ventas'}`;

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function DashboardBody({ data }: { data: DashboardSummary }) {
  const { sales, cash, inventory } = data;
  const methodMax = Math.max(0, ...data.byMethod.map((method) => method.amount));
  const hours = visibleHours(data.byHour).filter((row) => row.count > 0);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={Receipt}
          label="Ventas de hoy"
          value={formatCOP(sales.total)}
          detail={
            sales.count === 0
              ? 'Aún sin ventas'
              : `${String(sales.count)} ${sales.count === 1 ? 'venta' : 'ventas'} · promedio ${formatCOP(sales.average)}`
          }
        />
        <Kpi
          icon={Banknote}
          label="Efectivo en cajas"
          value={formatCOP(cash.expectedCashTotal)}
          detail={
            cash.openShifts.length === 0
              ? 'No hay cajas abiertas'
              : `${String(cash.openShifts.length)} ${cash.openShifts.length === 1 ? 'caja abierta' : 'cajas abiertas'}`
          }
        />
        <Kpi
          icon={TrendingDown}
          label="Egresos y retiros"
          value={formatCOP(cash.expensesTotal + cash.withdrawalsTotal)}
          detail={`Egresos ${formatCOP(cash.expensesTotal)} · retiros ${formatCOP(cash.withdrawalsTotal)}`}
        />
        <Kpi
          icon={BellRing}
          label="Bajo stock"
          tone={inventory.lowStockCount > 0 ? 'danger' : 'primary'}
          value={String(inventory.lowStockCount)}
          detail={
            inventory.trackedCount === 0
              ? 'Ningún producto controla inventario'
              : `de ${String(inventory.trackedCount)} productos con inventario`
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Kpi
          icon={Store}
          label="Ventas en el local"
          value={formatCOP(data.byOrigin.local.total)}
          detail={countLabel(data.byOrigin.local.count)}
        />
        <Kpi
          icon={ShoppingBag}
          label="Ventas de pedidos web"
          value={formatCOP(data.byOrigin.web.total)}
          detail={countLabel(data.byOrigin.web.count)}
        />
      </div>

      {sales.voidedCount > 0 || sales.discountsTotal > 0 || cash.closedWithDifference > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {sales.voidedCount > 0 ? (
            <li>
              <Badge tone="danger">
                {sales.voidedCount} {sales.voidedCount === 1 ? 'venta anulada' : 'ventas anuladas'}
              </Badge>
            </li>
          ) : null}
          {sales.discountsTotal > 0 ? (
            <li>
              <Badge tone="pending">Descuentos {formatCOP(sales.discountsTotal)}</Badge>
            </li>
          ) : null}
          {cash.closedWithDifference > 0 ? (
            <li>
              <Badge tone="danger">
                {cash.closedWithDifference}{' '}
                {cash.closedWithDifference === 1
                  ? 'cierre con diferencia'
                  : 'cierres con diferencia'}
              </Badge>
            </li>
          ) : null}
        </ul>
      ) : null}

      <Panel title="Ventas por hora">
        {sales.count === 0 ? (
          <EmptyState
            title="Todavía no hay ventas hoy"
            description="Aparecerán aquí apenas se cobre la primera."
          />
        ) : (
          <div className="grid gap-3">
            <SalesByHourChart byHour={data.byHour} />
            <details className="text-sm">
              <summary className="cursor-pointer font-bold text-primary">Ver como tabla</summary>
              <table className="mt-2 w-full">
                <caption className="sr-only">Ventas por hora</caption>
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-bold">Hora</th>
                    <th className="py-1 text-right font-bold">Ventas</th>
                    <th className="py-1 text-right font-bold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {hours.map((row) => (
                    <tr key={row.hour} className="border-t border-border">
                      <td className="py-1">{formatHour(row.hour)}</td>
                      <td className="py-1 text-right">{row.count}</td>
                      <td className="py-1 text-right font-bold">{formatCOP(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Medios de pago">
          {data.byMethod.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin cobros todavía.</p>
          ) : (
            <ul className="grid gap-4">
              {data.byMethod.map((method) => (
                <ShareRow
                  key={method.method}
                  label={PAYMENT_METHOD_LABELS[method.method]}
                  value={method.amount}
                  detail={`${String(method.count)} ${method.count === 1 ? 'pago' : 'pagos'}`}
                  max={methodMax}
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Lo más vendido">
          {data.topProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas todavía.</p>
          ) : (
            <ol className="grid gap-2">
              {data.topProducts.map((product, index) => (
                <li key={product.productId} className="flex items-center gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-extrabold text-accent-soft-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-bold">{product.name}</span>
                  <span className="text-sm text-muted-foreground">{product.quantity} und.</span>
                  <span className="min-w-20 text-right font-extrabold">
                    {formatCOP(product.total)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title="Cajas abiertas">
          {cash.openShifts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay cajas abiertas ahora.</p>
          ) : (
            <ul className="grid gap-3">
              {cash.openShifts.map((shift) => (
                <li key={shift.id} className="grid gap-0.5 rounded-xl bg-muted/60 px-3 py-2">
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="font-extrabold">{shift.userName}</span>
                    <span className="text-sm text-muted-foreground">
                      desde {formatTimeCO(new Date(shift.openedAt))}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {shift.salesCount} {shift.salesCount === 1 ? 'venta' : 'ventas'} ·{' '}
                    {formatCOP(shift.salesTotal)} · egresos {formatCOP(shift.expensesTotal)}
                  </p>
                  <p className="text-sm">
                    Efectivo esperado <strong>{formatCOP(shift.expectedCash)}</strong>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Alertas de inventario">
          {inventory.lowStock.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todo el stock está por encima del mínimo.
            </p>
          ) : (
            <ul className="grid gap-2">
              {inventory.lowStock.map((item) => (
                <li key={item.productId} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate font-bold">{item.name}</span>
                  <Badge tone="danger">
                    {item.quantity === 0 ? 'Sin stock' : `Quedan ${String(item.quantity)}`}
                  </Badge>
                  <span className="text-sm text-muted-foreground">mín. {item.minStock}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            Producido hoy: {inventory.producedToday} · mermas: {inventory.wastedToday}
          </p>
        </Panel>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}

/**
 * Resumen del día para el administrador. Se actualiza solo: el servidor avisa por Socket.IO
 * y, si el tiempo real no está disponible, se consulta cada 30 segundos.
 */
export function DashboardSection() {
  const queryClient = useQueryClient();
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.summary });
  }, [queryClient]);
  const status = useDashboardRealtime(refresh);

  const query = useQuery({
    queryKey: dashboardKeys.summary,
    queryFn: ({ signal }) => getDashboard(signal),
    staleTime: 0,
    refetchInterval: status === 'live' ? false : FALLBACK_POLL_MS,
  });

  return (
    <section aria-labelledby="resumen-hoy" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="resumen-hoy" className="text-xl font-extrabold">
          Resumen de hoy
        </h2>
        <div className="flex items-center gap-2">
          {query.data === undefined ? null : (
            <span className="text-sm text-muted-foreground">
              Actualizado {formatTimeCO(new Date(query.data.generatedAt))}
            </span>
          )}
          <LiveBadge status={status} />
        </div>
      </div>

      {query.data !== undefined ? (
        <DashboardBody data={query.data} />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <DashboardSkeleton />
      )}

      <ExportCard />
    </section>
  );
}
