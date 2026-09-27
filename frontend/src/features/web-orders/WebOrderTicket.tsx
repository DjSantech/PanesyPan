import {
  BUSINESS_NAME,
  formatCOP,
  formatDateTimeCO,
  type BusinessSettings,
  type WebOrder,
} from '@panesypan/shared';
import { PRINTABLE_WIDTH_MM } from '../pos/receipt-format';
import { lineLunchLabel } from './web-orders-logic';

const Divider = () => (
  <div className="my-1.5 border-t border-dashed border-current" aria-hidden="true" />
);

/** Comanda del pedido web para la impresora térmica (mismo ancho que el tiquete). */
export function WebOrderTicket({
  order,
  settings,
}: {
  order: WebOrder;
  settings: BusinessSettings;
}) {
  const { customer } = order;
  return (
    <article
      aria-label={`Comanda del pedido web ${String(order.number)}`}
      className={`bg-white px-[2mm] py-[3mm] font-mono leading-snug text-black ${
        settings.ticketWidth === '58' ? 'text-[10px]' : 'text-[12px]'
      }`}
      style={{ width: `${String(PRINTABLE_WIDTH_MM[settings.ticketWidth])}mm` }}
    >
      <p className="text-center font-extrabold">{BUSINESS_NAME}</p>
      <p className="text-center text-[1.35em] font-extrabold">Pedido web #{order.number}</p>
      <p className="text-center">{formatDateTimeCO(new Date(order.createdAt))}</p>
      <Divider />
      <p className="font-bold">{customer.name}</p>
      <p>Tel. {customer.phone}</p>
      <p>
        {customer.address} · {customer.neighborhood}
      </p>
      {customer.note === '' ? null : <p>Nota: {customer.note}</p>}
      <Divider />
      <ul className="grid gap-1">
        {order.lines.map((line, index) => (
          <li key={`${line.productId}-${String(index)}`}>
            <div className="flex justify-between gap-2">
              <span className="min-w-0">
                {line.quantity} × {line.name}
              </span>
              <span className="shrink-0 tabular-nums">{formatCOP(line.total)}</span>
            </div>
            {lineLunchLabel(line) === null ? null : <p className="pl-2">{lineLunchLabel(line)}</p>}
          </li>
        ))}
      </ul>
      <Divider />
      <div className="flex justify-between gap-2 font-extrabold">
        <span>Subtotal</span>
        <span className="tabular-nums">{formatCOP(order.subtotal)}</span>
      </div>
      <p>Domicilio: {order.deliveryFee === null ? 'a confirmar' : formatCOP(order.deliveryFee)}</p>
      <Divider />
      <p className="text-center">Comanda interna. No es documento de venta.</p>
    </article>
  );
}
