import {
  BUSINESS_NAME,
  formatCOP,
  formatDateTimeCO,
  PAYMENT_METHOD_LABELS,
  type BusinessSettings,
  type Sale,
} from '@panesypan/shared';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatSaleNumber, PRINTABLE_WIDTH_MM } from './receipt-format';

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
    <div className={cn('flex justify-between gap-2', strong && 'text-[1.15em] font-extrabold')}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

const Divider = () => (
  <div className="my-1.5 border-t border-dashed border-current" aria-hidden="true" />
);

/**
 * Tiquete de venta para impresora térmica. Solo usa negro sobre blanco y fuentes del sistema:
 * así se ve igual en la vista previa y en el papel.
 */
export function Receipt({
  sale,
  settings,
  className,
}: {
  sale: Sale;
  settings: BusinessSettings;
  className?: string;
}) {
  const is58 = settings.ticketWidth === '58';
  const date = new Date(sale.paidAt ?? sale.openedAt);
  const discountLabel =
    sale.discount?.mode === 'PERCENT'
      ? `Descuento (${String(sale.discount.value)} %)`
      : 'Descuento';

  return (
    <article
      aria-label={`Tiquete de la venta ${formatSaleNumber(sale.number)}`}
      className={cn(
        'bg-white font-mono leading-snug text-black',
        is58 ? 'text-[10px]' : 'text-[12px]',
        className,
      )}
      style={{ width: `${String(PRINTABLE_WIDTH_MM[settings.ticketWidth])}mm` }}
    >
      <header className="text-center">
        <p className="text-[1.35em] font-extrabold">{BUSINESS_NAME}</p>
        {settings.legalName === '' ? null : <p>{settings.legalName}</p>}
        {settings.taxId === '' ? null : <p>NIT {settings.taxId}</p>}
        {settings.address === '' ? null : <p>{settings.address}</p>}
        {settings.phone === '' ? null : <p>Tel. {settings.phone}</p>}
      </header>
      <Divider />
      <Row label={<strong>Venta N.º {formatSaleNumber(sale.number)}</strong>} value="" />
      <p>{formatDateTimeCO(date)}</p>
      <p>{sale.tableNumber === null ? 'Mostrador' : `Mesa ${String(sale.tableNumber)}`}</p>
      {sale.paidBy === null ? null : <p>Atendió: {sale.paidBy.name}</p>}
      <Divider />
      <ul className="grid gap-1">
        {sale.lines.map((line) => (
          <li key={line.id}>
            <Row label={`${String(line.quantity)} × ${line.name}`} value={formatCOP(line.total)} />
            {line.quantity > 1 ? <p className="pl-3">{formatCOP(line.unitPrice)} c/u</p> : null}
            {line.note === '' ? null : <p className="pl-3">({line.note})</p>}
          </li>
        ))}
      </ul>
      <Divider />
      {sale.discount === null ? null : (
        <>
          <Row label="Subtotal" value={formatCOP(sale.subtotal)} />
          <Row label={discountLabel} value={`−${formatCOP(sale.discount.amount)}`} />
        </>
      )}
      <Row label="TOTAL" value={formatCOP(sale.total)} strong />
      {sale.payments.map((payment) => (
        <Row
          key={payment.method}
          label={PAYMENT_METHOD_LABELS[payment.method]}
          value={formatCOP(payment.amount)}
        />
      ))}
      {sale.cashReceived === null ? null : (
        <>
          <Row label="Recibido" value={formatCOP(sale.cashReceived)} />
          <Row label="Cambio" value={formatCOP(sale.change)} />
        </>
      )}
      <Divider />
      <p className="text-center">Precios con impuestos incluidos</p>
      {settings.ticketFooter === '' ? null : (
        <p className="mt-1 text-center font-bold">{settings.ticketFooter}</p>
      )}
      {sale.status === 'VOIDED' ? (
        <p className="mt-2 border-2 border-current py-1 text-center text-[1.3em] font-extrabold">
          ANULADA
        </p>
      ) : null}
    </article>
  );
}
