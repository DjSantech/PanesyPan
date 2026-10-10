import {
  formatCOP,
  PURCHASE_PAYMENT_LABELS,
  PURCHASE_STATUS_LABELS,
  voidPurchaseRequestSchema,
  type Purchase,
} from '@panesypan/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { Alert, Badge } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { catalogKeys } from '../catalog/catalog.api';
import { inventoryKeys } from '../inventory/inventory.api';
import { ApprovalDialog } from '../pos/ApprovalDialog';
import { posKeys } from '../pos/pos.api';
import { useApprovedAction } from '../pos/use-approved-action';
import { purchaseKeys, voidPurchase } from './purchases.api';

/** AAAA-MM-DD → DD/MM/AAAA. */
const shortDate = (date: string): string => date.split('-').reverse().join('/');

interface PurchaseDetailDialogProps {
  purchase: Purchase | null;
  onOpenChange: (open: boolean) => void;
}

/** Detalle de una compra, con la opción de anularla (PIN de administrador y motivo). */
export function PurchaseDetailDialog({ purchase, onOpenChange }: PurchaseDetailDialogProps) {
  return (
    <Dialog open={purchase !== null} onOpenChange={onOpenChange}>
      {purchase === null ? null : (
        <PurchaseDetail
          key={purchase.id}
          purchase={purchase}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      )}
    </Dialog>
  );
}

function PurchaseDetail({ purchase, onDone }: { purchase: Purchase; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const voided = purchase.status === 'VOIDED';

  const action = useApprovedAction<Purchase>({
    run: (pin) =>
      voidPurchase(purchase.id, {
        reason: reason.trim(),
        ...(pin === undefined ? {} : { approverPin: pin }),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: posKeys.shift });
      void queryClient.invalidateQueries({ queryKey: posKeys.movements });
      toast.success(
        result.voidCashRefunded === false
          ? `Compra N.º ${String(result.number)} anulada. La caja ya estaba cerrada: el efectivo no se tocó.`
          : `Compra N.º ${String(result.number)} anulada`,
      );
      onDone();
    },
    onError: (error) => {
      setFailure(errorMessage(error));
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(null);
    const parsed = voidPurchaseRequestSchema.safeParse({ reason });
    if (!parsed.success) {
      setFailure(parsed.error.issues[0]?.message ?? 'Escribe el motivo de la anulación');
      return;
    }
    action.execute();
  };

  return (
    <DialogContent
      title={`Compra N.º ${String(purchase.number)}`}
      description={`${purchase.supplier.name} · ${shortDate(purchase.businessDate)}`}
      className="sm:max-w-xl"
    >
      <div className="grid gap-4">
        <p className="flex flex-wrap items-center gap-2">
          <Badge>{PURCHASE_PAYMENT_LABELS[purchase.paymentMethod]}</Badge>
          <Badge tone={voided ? 'danger' : 'success'}>
            {PURCHASE_STATUS_LABELS[purchase.status]}
          </Badge>
        </p>
        <ul className="divide-y divide-border text-sm">
          {purchase.lines.map((line, index) => (
            <li key={`${line.name}-${String(index)}`} className="flex gap-3 py-2">
              <span className="min-w-0 flex-1">
                {line.quantity} × {line.name}
                <span className="text-muted-foreground"> ({formatCOP(line.unitCost)})</span>
              </span>
              <span className="font-bold tabular-nums">{formatCOP(line.total)}</span>
            </li>
          ))}
        </ul>
        <p className="flex justify-between rounded-xl bg-muted px-4 py-3 text-lg">
          <span className="font-bold">Total</span>
          <span className="font-extrabold tabular-nums">{formatCOP(purchase.total)}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Registró {purchase.createdBy}
          {purchase.approvedBy === null ? '' : ` · autorizó ${purchase.approvedBy}`}
          {purchase.reference === '' ? '' : ` · ref. ${purchase.reference}`}
          {purchase.note === '' ? '' : ` · ${purchase.note}`}
        </p>

        {voided ? (
          <Alert tone="danger">
            Anulada
            {purchase.voidedBy === null ? '' : ` por ${purchase.voidedBy}`}: {purchase.voidReason}
            {purchase.voidCashRefunded === true ? ' · el efectivo volvió a la caja.' : ''}
            {purchase.voidCashRefunded === false
              ? ' · la caja ya estaba cerrada: el efectivo no se tocó.'
              : ''}
          </Alert>
        ) : voiding ? (
          <form className="grid gap-3" onSubmit={handleSubmit} noValidate>
            <Field id="purchase-void-reason" label="Motivo de la anulación">
              <Textarea
                id="purchase-void-reason"
                maxLength={200}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            </Field>
            <p className="text-sm text-muted-foreground">
              Se saca del stock lo que entró con esta compra.
              {purchase.paymentMethod === 'CASH_DRAWER'
                ? ' Si la caja con la que se pagó sigue abierta, el efectivo vuelve a ella como un reintegro.'
                : ''}
            </p>
            {failure === null ? null : <Alert tone="danger">{failure}</Alert>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setVoiding(false);
                  setFailure(null);
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" disabled={action.pending}>
                {action.pending ? <Spinner /> : null} Anular compra
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="outline"
            className="justify-self-start"
            onClick={() => {
              setVoiding(true);
            }}
          >
            <Ban aria-hidden="true" /> Anular compra
          </Button>
        )}
      </div>
      <ApprovalDialog
        {...action.approvalProps}
        description="Anular una compra necesita la autorización de un administrador: pide que digite su PIN."
      />
    </DialogContent>
  );
}
