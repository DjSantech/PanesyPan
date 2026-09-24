import { formatCOP, SALE_LIMITS, type Sale } from '@panesypan/shared';
import { useState, type SubmitEvent } from 'react';
import { Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { ApprovalDialog } from './ApprovalDialog';
import { useApprovedAction } from './use-approved-action';

/** Pasar la cuenta a otra mesa libre (el cliente se cambió de mesa). */
export function MoveTabDialog({
  tab,
  tableCount,
  busyTables,
  pending,
  onOpenChange,
  onMove,
}: {
  tab: Sale | null;
  tableCount: number;
  busyTables: ReadonlySet<number>;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (tableNumber: number) => void;
}) {
  return (
    <Dialog open={tab !== null} onOpenChange={onOpenChange}>
      {tab === null ? null : (
        <DialogContent
          title={`Cambiar la mesa ${String(tab.tableNumber ?? '')}`}
          description="Elige la mesa libre a la que pasa la cuenta."
        >
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: tableCount }, (_, index) => index + 1).map((tableNumber) => {
              const busy = busyTables.has(tableNumber);
              return (
                <Button
                  key={tableNumber}
                  variant="outline"
                  size="lg"
                  className={cn('h-14 text-lg', busy && 'line-through')}
                  disabled={busy || pending}
                  aria-label={`Mesa ${String(tableNumber)}${busy ? ', ocupada' : ''}`}
                  onClick={() => {
                    onMove(tableNumber);
                  }}
                >
                  {tableNumber}
                </Button>
              );
            })}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

/**
 * Cancelar la cuenta de una mesa sin cobrarla. Con productos, la API pide el PIN de un
 * administrador (queda en la auditoría).
 */
export function CancelTabDialog({
  tab,
  onOpenChange,
  cancel,
  onCanceled,
  onError,
}: {
  tab: Sale | null;
  onOpenChange: (open: boolean) => void;
  cancel: (tab: Sale, reason: string, pin: string | undefined) => Promise<Sale>;
  onCanceled: (sale: Sale) => void;
  onError: (error: unknown) => void;
}) {
  return (
    <Dialog open={tab !== null} onOpenChange={onOpenChange}>
      {tab === null ? null : (
        <CancelForm
          tab={tab}
          onOpenChange={onOpenChange}
          cancel={cancel}
          onCanceled={onCanceled}
          onError={onError}
        />
      )}
    </Dialog>
  );
}

function CancelForm({
  tab,
  onOpenChange,
  cancel,
  onCanceled,
  onError,
}: {
  tab: Sale;
  onOpenChange: (open: boolean) => void;
  cancel: (tab: Sale, reason: string, pin: string | undefined) => Promise<Sale>;
  onCanceled: (sale: Sale) => void;
  onError: (error: unknown) => void;
}) {
  const [reason, setReason] = useState('');
  const action = useApprovedAction<Sale>({
    run: (pin) => cancel(tab, reason.trim(), pin),
    onSuccess: onCanceled,
    onError,
  });
  const valid = reason.trim().length >= SALE_LIMITS.reasonMin;

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (valid) action.execute();
  };

  return (
    <DialogContent
      title={`¿Cancelar la cuenta de la mesa ${String(tab.tableNumber ?? '')}?`}
      description={
        tab.lines.length === 0
          ? 'La mesa está vacía: solo se libera.'
          : `Tiene ${formatCOP(tab.total)} sin cobrar. Se necesita el PIN de un administrador.`
      }
    >
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        <Field id="cancel-reason" label="Motivo">
          <Input
            id="cancel-reason"
            autoFocus
            placeholder="Ej.: el cliente se fue sin consumir"
            maxLength={SALE_LIMITS.reasonMax}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        <DialogFooter className="mt-0">
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={action.pending}
          >
            Volver
          </Button>
          <Button type="submit" variant="destructive" disabled={!valid || action.pending}>
            {action.pending ? <Spinner /> : null}
            Cancelar cuenta
          </Button>
        </DialogFooter>
      </form>
      <ApprovalDialog {...action.approvalProps} />
    </DialogContent>
  );
}
