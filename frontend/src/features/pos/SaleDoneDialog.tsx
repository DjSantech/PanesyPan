import {
  formatCOP,
  PAYMENT_METHOD_LABELS,
  type BusinessSettings,
  type Sale,
} from '@panesypan/shared';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, Printer } from 'lucide-react';
import { Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { EInvoiceBadge } from '../einvoice/EInvoiceBadge';
import { isEInvoiceInFlight } from '../einvoice/einvoice-logic';
import { getSale, posKeys } from './pos.api';
import { printTicket } from './direct-print';
import { formatSaleNumber } from './receipt-format';

/** Cuánto se espera la validación de la factura antes de dejar de consultar (2 s × 15). */
const EINVOICE_POLL_MS = 2_000;
const EINVOICE_POLL_TIMES = 15;

/**
 * Sigue la factura electrónica de la venta recién cobrada hasta que la DIAN la valida (o
 * hasta rendirse): así el tiquete sale con su CUFE y su QR.
 */
function useLiveSale(sale: Sale) {
  const query = useQuery({
    queryKey: posKeys.sale(sale.id),
    queryFn: ({ signal }) => getSale(sale.id, signal),
    initialData: sale,
    staleTime: 0,
    enabled: sale.einvoice !== null,
    refetchInterval: (current) =>
      isEInvoiceInFlight(current.state.data?.einvoice?.status) &&
      current.state.dataUpdateCount < EINVOICE_POLL_TIMES
        ? EINVOICE_POLL_MS
        : false,
  });
  return query.data;
}

function DoneContent({
  sale: initial,
  settings,
  onClose,
  closeLabel,
}: {
  sale: Sale;
  settings: BusinessSettings | undefined;
  onClose: () => void;
  closeLabel: string;
}) {
  const sale = useLiveSale(initial);
  const einvoice = sale.einvoice;
  const validating = isEInvoiceInFlight(einvoice?.status);

  return (
    <DialogContent
      title={`Venta N.º ${formatSaleNumber(sale.number)} registrada`}
      description={sale.payments
        .map((payment) => `${PAYMENT_METHOD_LABELS[payment.method]} ${formatCOP(payment.amount)}`)
        .join(' · ')}
    >
      <div className="grid justify-items-center gap-3 py-2 text-center">
        <CircleCheck className="size-12 text-success" aria-hidden="true" />
        {sale.cashReceived === null ? (
          <p className="text-3xl font-extrabold">{formatCOP(sale.total)}</p>
        ) : (
          <div className="grid gap-1" aria-live="polite">
            <p className="text-sm font-bold text-muted-foreground">
              Recibido {formatCOP(sale.cashReceived)} · Total {formatCOP(sale.total)}
            </p>
            <p className="text-lg font-bold">Cambio</p>
            <p className="text-5xl font-extrabold text-success">{formatCOP(sale.change)}</p>
          </div>
        )}
        {einvoice === null ? null : (
          <p className="flex items-center gap-2 text-sm" aria-live="polite">
            {validating ? <Spinner className="size-4" /> : null}
            <EInvoiceBadge status={einvoice.status} prefix="Factura electrónica" />
            {einvoice.number === null ? null : <span className="font-bold">{einvoice.number}</span>}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          size="lg"
          disabled={settings === undefined}
          onClick={() => {
            if (settings !== undefined) void printTicket(sale, settings);
          }}
        >
          <Printer aria-hidden="true" /> Imprimir tiquete
        </Button>
        <Button size="lg" autoFocus onClick={onClose}>
          {closeLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** Confirmación del cobro: el cambio en grande y el botón para imprimir el tiquete. */
export function SaleDoneDialog({
  sale,
  settings,
  onClose,
  closeLabel = 'Nueva venta',
}: {
  sale: Sale | null;
  settings: BusinessSettings | undefined;
  onClose: () => void;
  /** Texto del botón que cierra el diálogo. */
  closeLabel?: string;
}) {
  return (
    <Dialog
      open={sale !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {sale === null ? null : (
        <DoneContent
          key={sale.id}
          sale={sale}
          settings={settings}
          onClose={onClose}
          closeLabel={closeLabel}
        />
      )}
    </Dialog>
  );
}
