import { cancelWebOrderRequestSchema, type Sale, type WebOrder } from '@panesypan/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { Link } from 'react-router';
import { Spinner } from '@/components/feedback';
import { PriceInput } from '@/components/PriceInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';
import { useCan } from '@/features/auth/use-session';
import { CheckoutDialog } from '@/features/pos/CheckoutDialog';
import { getCurrentShift, posKeys } from '@/features/pos/pos.api';
import { useSettings } from '@/features/settings/settings.api';
import { errorMessage } from '@/lib/api-errors';
import { cancelWebOrder, checkoutWebOrder } from './web-orders.api';
import { deliveryFeeNote } from './web-orders-logic';

/** Cobro del pedido web con el mismo diálogo del POS, más el domicilio aparte. */
export function WebOrderCheckoutDialog({
  order,
  onClose,
  onPaid,
  onStale,
}: {
  order: WebOrder | null;
  onClose: () => void;
  onPaid: (sale: Sale) => void;
  onStale: (message: string) => void;
}) {
  const settings = useSettings();
  const canApprove = useCan('sales:void:approve');
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const shift = useQuery({
    queryKey: posKeys.shift,
    queryFn: ({ signal }) => getCurrentShift(signal),
    enabled: order !== null,
  });

  const close = () => {
    setDeliveryFee(null);
    onClose();
  };

  if (order !== null && shift.data === null) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent title={`Cobrar pedido #${String(order.number)}`}>
          <Alert tone="pending">
            Para cobrar necesitas tener la caja abierta.{' '}
            <Link to="/vender" className="font-bold underline">
              Abrir caja
            </Link>
          </Alert>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              Volver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const note = deliveryFeeNote(deliveryFee);
  return (
    <CheckoutDialog
      open={order !== null && shift.data !== undefined}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={order === null ? '' : `Cobrar pedido #${String(order.number)}`}
      subtotal={order?.total ?? 0}
      maxDiscountPercent={settings.data?.maxCashierDiscountPercent ?? 0}
      einvoiceEnabled={settings.data?.einvoiceEnabled ?? false}
      canApprove={canApprove}
      blocked={deliveryFee === null}
      beforePayments={
        <div className="grid gap-1">
          <Field id="delivery-fee" label="Domicilio (lo cobra el domiciliario)">
            <PriceInput id="delivery-fee" value={deliveryFee} onValueChange={setDeliveryFee} />
          </Field>
          <p className="text-sm text-muted-foreground">
            {note ?? 'Escribe el domicilio (0 si no hay). No suma al total a cobrar.'}
          </p>
        </div>
      }
      submit={async (payload) => {
        if (order === null || deliveryFee === null) throw new Error('Pedido no disponible');
        const result = await checkoutWebOrder(order.id, { ...payload, deliveryFee });
        return result.sale;
      }}
      onPaid={(sale) => {
        setDeliveryFee(null);
        onPaid(sale);
      }}
      onStale={(message) => {
        setDeliveryFee(null);
        onStale(message);
      }}
    />
  );
}

/** Cancelación con motivo obligatorio (sin PIN, solo antes de cobrar). */
export function CancelWebOrderDialog({
  order,
  onClose,
  onCanceled,
}: {
  order: WebOrder | null;
  onClose: () => void;
  onCanceled: (order: WebOrder) => void;
}) {
  return (
    <Dialog
      open={order !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {order === null ? null : (
        <CancelForm key={order.id} order={order} onClose={onClose} onCanceled={onCanceled} />
      )}
    </Dialog>
  );
}

function CancelForm({
  order,
  onClose,
  onCanceled,
}: {
  order: WebOrder;
  onClose: () => void;
  onCanceled: (order: WebOrder) => void;
}) {
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: (value: string) => cancelWebOrder(order.id, { reason: value }),
    onSuccess: onCanceled,
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = cancelWebOrderRequestSchema.safeParse({ reason });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Escribe el motivo');
      return;
    }
    setFieldError(null);
    cancel.mutate(parsed.data.reason);
  };

  return (
    <DialogContent title={`Cancelar pedido #${String(order.number)}`}>
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        <Field id="cancel-reason" label="Motivo" error={fieldError}>
          <Input
            id="cancel-reason"
            autoFocus
            maxLength={120}
            placeholder="Ej.: el cliente no contesta"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        {cancel.isError ? <Alert tone="danger">{errorMessage(cancel.error)}</Alert> : null}
        <DialogFooter className="mt-0">
          <Button variant="outline" onClick={onClose} disabled={cancel.isPending}>
            Volver
          </Button>
          <Button type="submit" variant="destructive" disabled={cancel.isPending}>
            {cancel.isPending ? <Spinner /> : null} Cancelar pedido
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
