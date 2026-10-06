import {
  BUSINESS_NAME,
  CASH_MOVEMENT_LABELS,
  CASH_MOVEMENT_TYPES,
  formatCOP,
  formatDateTimeCO,
  PAYMENT_METHOD_LABELS,
  type CashShiftDetail,
  type TicketWidth,
} from '@panesypan/shared';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PRINTABLE_WIDTH_MM } from '../pos/receipt-format';
import { shiftTitle } from './cash-history.api';

function Row({
  label,
  value,
  strong = false,
}: {
  label: ReactNode;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className={cn('flex justify-between gap-2', strong && 'font-extrabold')}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border-t border-dashed border-current pt-1.5">
    <p className="font-extrabold uppercase">{title}</p>
    {children}
  </section>
);

/**
 * Resumen de una caja para imprimir en la tirilla al cierre (el mismo desglose del historial):
 * base, ventas por medio de pago, descuentos, ingresos, egresos y retiros por tipo, arqueo.
 */
export function ShiftReport({
  detail,
  ticketWidth,
  className,
}: {
  detail: CashShiftDetail;
  ticketWidth: TicketWidth;
  className?: string;
}) {
  const { shift, byConcept } = detail;
  const { summary, closing } = shift;
  return (
    <article
      aria-label={`Resumen de la ${shiftTitle(shift)}`}
      className={cn(
        'grid gap-1.5 bg-white font-mono leading-snug text-black',
        ticketWidth === '58' ? 'text-[10px]' : 'text-[12px]',
        className,
      )}
      style={{ width: `${String(PRINTABLE_WIDTH_MM[ticketWidth])}mm` }}
    >
      <header className="text-center">
        <p className="text-[1.25em] font-extrabold">{BUSINESS_NAME}</p>
        <p className="font-bold">{shiftTitle(shift)}</p>
        <p>{shift.userName}</p>
        <p>Abrió {formatDateTimeCO(new Date(shift.openedAt))}</p>
        {shift.closedAt === null ? null : <p>Cerró {formatDateTimeCO(new Date(shift.closedAt))}</p>}
      </header>

      <Section title="Ventas">
        <Row
          label={`Ventas (${String(summary.salesCount)})`}
          value={formatCOP(summary.salesTotal)}
        />
        {summary.byMethod.map((entry) => (
          <Row
            key={entry.method}
            label={`  ${PAYMENT_METHOD_LABELS[entry.method]}`}
            value={formatCOP(entry.amount)}
          />
        ))}
        {summary.discountsTotal > 0 ? (
          <Row label="Descuentos" value={formatCOP(summary.discountsTotal)} />
        ) : null}
        {summary.voidedCount > 0 ? (
          <Row label="Anuladas" value={String(summary.voidedCount)} />
        ) : null}
      </Section>

      {CASH_MOVEMENT_TYPES.map((type) => {
        const rows = byConcept.filter((entry) => entry.type === type);
        if (rows.length === 0) return null;
        return (
          <Section key={type} title={`${CASH_MOVEMENT_LABELS[type]}s`}>
            {rows.map((entry) => (
              <Row
                key={entry.name}
                label={`${entry.name}${entry.count > 1 ? ` (${String(entry.count)})` : ''}`}
                value={formatCOP(entry.amount)}
              />
            ))}
          </Section>
        );
      })}

      <Section title="Efectivo">
        <Row label="Base inicial" value={formatCOP(shift.openingAmount)} />
        <Row
          label="+ Ventas en efectivo"
          value={formatCOP(summary.byMethod.find((entry) => entry.method === 'CASH')?.amount ?? 0)}
        />
        <Row label="+ Ingresos" value={formatCOP(summary.incomesTotal)} />
        <Row label="− Egresos" value={formatCOP(summary.expensesTotal)} />
        <Row label="− Retiros" value={formatCOP(summary.withdrawalsTotal)} />
        <Row
          label="Esperado"
          value={formatCOP(closing?.expectedCash ?? summary.expectedCash)}
          strong
        />
        {closing === null ? null : (
          <>
            <Row label="Contado" value={formatCOP(closing.countedCash)} strong />
            <Row
              label={
                closing.difference === 0
                  ? 'Cuadra exacto'
                  : closing.difference > 0
                    ? 'Sobrante'
                    : 'Faltante'
              }
              value={formatCOP(Math.abs(closing.difference))}
              strong
            />
            {closing.leftForNext === null ? null : (
              <>
                <Row label="Queda de base" value={formatCOP(closing.leftForNext)} />
                <Row
                  label="Para guardar"
                  value={formatCOP(closing.countedCash - closing.leftForNext)}
                />
              </>
            )}
            {closing.note === '' ? null : <p>Nota: {closing.note}</p>}
          </>
        )}
      </Section>

      {shift.confirmedAt === null ? null : (
        <p className="border-t border-dashed border-current pt-1.5 text-center">
          Confirmada por {shift.confirmedBy} el {formatDateTimeCO(new Date(shift.confirmedAt))}
        </p>
      )}
    </article>
  );
}
