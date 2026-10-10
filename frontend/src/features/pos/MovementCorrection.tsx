import { CASH_MOVEMENT_LABELS, formatCOP, type CashMovement } from '@panesypan/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { PriceInput } from '@/components/PriceInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { useCashConcepts } from '../settings/cash-config.api';
import { ApprovalDialog } from './ApprovalDialog';
import { posKeys, updateMovement, voidMovement } from './pos.api';
import { useApprovedAction } from './use-approved-action';

export type CorrectionMode = 'edit' | 'void';

interface MovementCorrectionDialogProps {
  movement: CashMovement | null;
  mode: CorrectionMode;
  onOpenChange: (open: boolean) => void;
}

/** Corregir o anular un egreso, retiro o ingreso de la caja abierta (siempre con PIN). */
export function MovementCorrectionDialog({
  movement,
  mode,
  onOpenChange,
}: MovementCorrectionDialogProps) {
  return (
    <Dialog open={movement !== null} onOpenChange={onOpenChange}>
      {movement === null ? null : (
        <CorrectionForm
          key={`${movement.id}-${mode}`}
          movement={movement}
          mode={mode}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      )}
    </Dialog>
  );
}

function CorrectionForm({
  movement,
  mode,
  onDone,
}: {
  movement: CashMovement;
  mode: CorrectionMode;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const concepts = useCashConcepts();
  const [amount, setAmount] = useState<number | null>(movement.amount);
  const [conceptId, setConceptId] = useState(movement.conceptId ?? '');
  const [reason, setReason] = useState(mode === 'edit' ? movement.reason : '');
  const [failure, setFailure] = useState<string | null>(null);
  const label = CASH_MOVEMENT_LABELS[movement.type].toLowerCase();
  const options = (concepts.data ?? []).filter((concept) => concept.type === movement.type);

  const action = useApprovedAction<CashMovement>({
    run: (pin) => {
      const approval = pin === undefined ? {} : { approverPin: pin };
      return mode === 'void'
        ? voidMovement(movement.id, { reason: reason.trim(), ...approval })
        : updateMovement(movement.id, {
            amount: amount ?? 0,
            conceptId: conceptId === '' ? null : conceptId,
            reason: reason.trim(),
            ...approval,
          });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: posKeys.shift });
      void queryClient.invalidateQueries({ queryKey: posKeys.movements });
      toast.success(mode === 'void' ? 'Movimiento anulado' : 'Movimiento corregido');
      onDone();
    },
    onError: (error) => {
      setFailure(errorMessage(error));
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(null);
    if (mode === 'void' && reason.trim().length < 3) {
      setFailure('Escribe el motivo (mínimo 3 caracteres)');
      return;
    }
    if (mode === 'edit' && (amount ?? 0) < 1) {
      setFailure('El monto debe ser mayor a cero');
      return;
    }
    action.execute();
  };

  return (
    <DialogContent
      title={mode === 'void' ? `Anular ${label}` : `Corregir ${label}`}
      description={
        mode === 'void'
          ? `El registro de ${formatCOP(movement.amount)} queda, pero deja de contar en la caja. Lo autoriza un administrador.`
          : 'El cambio queda en la auditoría con el antes y el después. Lo autoriza un administrador.'
      }
    >
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        {mode === 'edit' ? (
          <>
            <Field id="correction-amount" label="Monto">
              <PriceInput id="correction-amount" value={amount} onValueChange={setAmount} />
            </Field>
            {options.length === 0 ? null : (
              <Field id="correction-concept" label="Tipo">
                <NativeSelect
                  id="correction-concept"
                  value={conceptId}
                  onChange={(event) => {
                    setConceptId(event.target.value);
                  }}
                >
                  <option value="">Sin tipo</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </>
        ) : null}
        <Field
          id="correction-reason"
          label={mode === 'void' ? 'Motivo de la anulación' : 'Detalle'}
        >
          <Input
            id="correction-reason"
            value={reason}
            maxLength={200}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </Field>
        {failure === null ? null : <Alert tone="danger">{failure}</Alert>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant={mode === 'void' ? 'destructive' : 'default'}
            disabled={action.pending}
          >
            {mode === 'void' ? 'Anular' : 'Guardar'}
          </Button>
        </DialogFooter>
      </form>
      <ApprovalDialog {...action.approvalProps} />
    </DialogContent>
  );
}
