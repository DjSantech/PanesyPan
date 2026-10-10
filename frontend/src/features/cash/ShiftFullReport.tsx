import {
  formatCOP,
  formatTimeCO,
  PAYMENT_METHOD_LABELS,
  type CashShiftDetail,
} from '@panesypan/shared';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

function Line({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className={cn('flex justify-between gap-2', strong && 'font-extrabold')}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatCOP(value)}</dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1">
      <h3 className="text-sm font-extrabold">{title}</h3>
      {children}
    </section>
  );
}

const Empty = () => <p className="text-sm text-muted-foreground">Ninguno.</p>;

/**
 * Detalle completo de una caja para el administrador: cifras con costo y utilidad bruta, y las
 * ventas, ingresos, egresos y compras del turno.
 */
export function ShiftFullReport({ detail }: { detail: CashShiftDetail }) {
  const { report, movements } = detail;
  if (report === undefined) return null;
  const p = report.performance;
  const incomes = movements.filter((movement) => movement.type === 'INCOME');
  const expenses = movements.filter((movement) => movement.type !== 'INCOME');

  return (
    <div className="grid gap-4 text-sm">
      <Block title="Resumen">
        <dl className="grid gap-0.5 sm:grid-cols-2 sm:gap-x-6">
          <Line label="Base" value={p.openingAmount} />
          {p.byMethod.map((entry) => (
            <Line
              key={entry.method}
              label={`Ventas ${PAYMENT_METHOD_LABELS[entry.method]}`}
              value={entry.amount}
            />
          ))}
          <Line label={`Total ventas (${String(p.salesCount)})`} value={p.salesTotal} strong />
          <Line label="Descuentos" value={p.discountsTotal} />
          <Line label={`Anulaciones (${String(p.voidedCount)})`} value={p.voidedTotal} />
          <Line label="Devoluciones" value={p.returnsTotal} />
          <Line label="Costo" value={p.costOfSales} />
          <Line label="Utilidad bruta" value={p.grossProfit} strong />
          <Line label="Ingresos" value={p.incomesTotal} />
          <Line label="Egresos" value={p.expensesTotal} />
          <Line label="Compras" value={p.purchasesTotal} />
          <Line label="Retiros" value={p.withdrawalsTotal} />
          <Line label="Caja final" value={p.closingCash} strong />
        </dl>
      </Block>

      <Block title={`Ventas (${String(report.sales.length)})`}>
        {report.sales.length === 0 ? (
          <Empty />
        ) : (
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full tabular-nums">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th>N.º</th>
                  <th>Hora</th>
                  <th>Pago</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Costo</th>
                </tr>
              </thead>
              <tbody>
                {report.sales.map((sale) => (
                  <tr key={sale.id} className={cn(sale.status === 'VOIDED' && 'line-through')}>
                    <td>{sale.number ?? '—'}</td>
                    <td>{sale.paidAt === null ? '—' : formatTimeCO(new Date(sale.paidAt))}</td>
                    <td>
                      {sale.status === 'VOIDED'
                        ? 'Anulada'
                        : sale.methods.map((method) => PAYMENT_METHOD_LABELS[method]).join(' + ')}
                    </td>
                    <td className="text-right">{formatCOP(sale.total)}</td>
                    <td className="text-right">{formatCOP(sale.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>

      {(
        [
          ['Ingresos', incomes],
          ['Egresos y retiros', expenses],
        ] as const
      ).map(([title, list]) => (
        <Block key={title} title={title}>
          {list.length === 0 ? (
            <Empty />
          ) : (
            <ul className="grid gap-0.5">
              {list.map((movement) => (
                <li key={movement.id} className="flex justify-between gap-2">
                  <span>
                    {formatTimeCO(new Date(movement.createdAt))} ·{' '}
                    {movement.conceptName ??
                      (movement.type === 'WITHDRAWAL' ? 'Retiro' : 'Sin tipo')}
                    {movement.reason === '' ? '' : ` — ${movement.reason}`}
                  </span>
                  <span className="tabular-nums">{formatCOP(movement.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>
      ))}

      <Block title="Compras">
        {report.purchases.length === 0 ? (
          <Empty />
        ) : (
          <ul className="grid gap-0.5">
            {report.purchases.map((purchase) => (
              <li key={purchase.id} className="flex justify-between gap-2">
                <span>
                  N.º {purchase.number} · {purchase.supplierName}
                </span>
                <span className="tabular-nums">{formatCOP(purchase.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  );
}
