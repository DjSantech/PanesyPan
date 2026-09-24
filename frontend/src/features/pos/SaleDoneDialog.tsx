import {
  formatCOP,
  PAYMENT_METHOD_LABELS,
  type BusinessSettings,
  type Sale,
} from '@panesypan/shared';
import { CircleCheck, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { printReceipt } from './print-receipt';
import { formatSaleNumber } from './receipt-format';

/** Confirmación del cobro: el cambio en grande y el botón para imprimir el tiquete. */
export function SaleDoneDialog({
  sale,
  settings,
  onClose,
}: {
  sale: Sale | null;
  settings: BusinessSettings | undefined;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={sale !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {sale === null ? null : (
        <DialogContent
          title={`Venta N.º ${formatSaleNumber(sale.number)} registrada`}
          description={sale.payments
            .map(
              (payment) => `${PAYMENT_METHOD_LABELS[payment.method]} ${formatCOP(payment.amount)}`,
            )
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
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="lg"
              disabled={settings === undefined}
              onClick={() => {
                if (settings !== undefined) printReceipt(sale, settings);
              }}
            >
              <Printer aria-hidden="true" /> Imprimir tiquete
            </Button>
            <Button size="lg" autoFocus onClick={onClose}>
              Nueva venta
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
