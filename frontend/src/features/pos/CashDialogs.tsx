import {
  CASH_MOVEMENT_LABELS,
  CASH_MOVEMENT_TYPES,
  cashDifference,
  countDenominations,
  createCashMovementRequestSchema,
  DENOMINATIONS,
  formatCOP,
  formatTimeCO,
  type CashMovement,
  type CashMovementType,
  type CashShift,
  type Denomination,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Lock, Minus, Plus } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Spinner } from '@/components/feedback';
import { PriceInput } from '@/components/PriceInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { ApprovalDialog } from './ApprovalDialog';
import { closeShift, createMovement, listMovements, posKeys } from './pos.api';
import { useApprovedAction } from './use-approved-action';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Panel de caja ──────────────────────────────────────────────────

interface CashPanelDialogProps extends DialogProps {
  shift: CashShift;
  onRegister: () => void;
  onClose: () => void;
}

/** Resumen del efectivo del turno, con los egresos y retiros, y las acciones de caja. */
export function CashPanelDialog({
  open,
  onOpenChange,
  shift,
  onRegister,
  onClose,
}: CashPanelDialogProps) {
  const { summary } = shift;
  const movements = useQuery({
    queryKey: posKeys.movements,
    queryFn: ({ signal }) => listMovements(signal),
    enabled: open,
  });
  const rows = [
    ['Base inicial', shift.openingAmount],
    ['Ventas en efectivo', summary.byMethod.find((m) => m.method === 'CASH')?.amount ?? 0],
    ['Egresos', -summary.expensesTotal],
    ['Retiros', -summary.withdrawalsTotal],
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Caja" description="Efectivo que debe haber en el cajón ahora.">
        <dl className="grid gap-1.5 text-sm">
          {rows.map(([label, amount]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-bold tabular-nums">{formatCOP(amount)}</dd>
            </div>
          ))}
          <div className="mt-1 flex justify-between gap-3 border-t border-border pt-2 text-base">
            <dt className="font-extrabold">Efectivo esperado</dt>
            <dd className="font-extrabold tabular-nums">{formatCOP(summary.expectedCash)}</dd>
          </div>
        </dl>

        <div className="mt-4 grid gap-2">
          <p className="text-sm font-bold">Egresos y retiros del turno</p>
          {movements.isPending ? (
            <Spinner label="Cargando…" />
          ) : movements.isError ? (
            <Alert tone="danger">{errorMessage(movements.error)}</Alert>
          ) : movements.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay movimientos.</p>
          ) : (
            <ul className="grid max-h-48 gap-1.5 overflow-y-auto">
              {movements.data.map((movement) => (
                <MovementRow key={movement.id} movement={movement} />
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onRegister}>
            Registrar egreso o retiro
          </Button>
          <Button onClick={onClose}>
            <Lock aria-hidden="true" /> Cerrar caja
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementRow({ movement }: { movement: CashMovement }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-xl bg-muted px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-bold">
          {CASH_MOVEMENT_LABELS[movement.type]} · {movement.reason}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatTimeCO(new Date(movement.createdAt))} · {movement.createdBy}
          {movement.approvedBy === null ? '' : ` · autorizó ${movement.approvedBy}`}
        </p>
      </div>
      <p className="font-extrabold tabular-nums">−{formatCOP(movement.amount)}</p>
    </li>
  );
}

// ── Egreso o retiro ────────────────────────────────────────────────

export function MovementDialog({ open, onOpenChange }: DialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <MovementForm onDone={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function MovementForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<CashMovementType>('EXPENSE');
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);

  const action = useApprovedAction<CashMovement>({
    run: (pin) =>
      createMovement({
        type,
        amount: amount ?? 0,
        reason: reason.trim(),
        ...(pin === undefined ? {} : { approverPin: pin }),
      }),
    onSuccess: (movement) => {
      void queryClient.invalidateQueries({ queryKey: posKeys.shift });
      toast.success(`${CASH_MOVEMENT_LABELS[movement.type]} registrado`);
      onDone();
    },
    onError: (error) => {
      setFailure(errorMessage(error));
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(null);
    const parsed = createCashMovementRequestSchema.safeParse({
      type,
      amount: amount ?? 0,
      reason,
    });
    if (!parsed.success) {
      const next: { amount?: string; reason?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'amount' || key === 'reason') && next[key] === undefined) {
          next[key] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    action.execute();
  };

  return (
    <DialogContent
      title="Egreso o retiro"
      description="El dinero sale de la caja y baja el efectivo esperado al cierre."
    >
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        <div
          className="grid grid-cols-2 rounded-xl bg-muted p-1"
          role="radiogroup"
          aria-label="Tipo de movimiento"
        >
          {CASH_MOVEMENT_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={type === value}
              onClick={() => {
                setType(value);
              }}
              className={cn(
                'h-11 rounded-lg text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                type === value ? 'bg-card shadow-xs' : 'text-muted-foreground',
              )}
            >
              {CASH_MOVEMENT_LABELS[value]}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {type === 'EXPENSE'
            ? 'Gasto menor pagado con la caja (hielo, gas, un domicilio…). Sobre el tope de Ajustes pide la autorización de un administrador.'
            : 'Efectivo que se saca para guardarlo. Siempre lo autoriza un administrador.'}
        </p>
        <Field id="movement-amount" label="Monto" error={errors.amount}>
          <PriceInput
            id="movement-amount"
            autoFocus
            className="h-14 text-2xl"
            value={amount}
            onValueChange={setAmount}
            aria-invalid={errors.amount === undefined ? undefined : true}
          />
        </Field>
        <Field id="movement-reason" label="Motivo" error={errors.reason}>
          <Input
            id="movement-reason"
            maxLength={200}
            placeholder={
              type === 'EXPENSE' ? 'Ej.: bolsa de hielo' : 'Ej.: guardar en la caja fuerte'
            }
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            aria-invalid={errors.reason === undefined ? undefined : true}
          />
        </Field>
        {failure === null ? null : <Alert tone="danger">{failure}</Alert>}
        <Button type="submit" size="lg" disabled={action.pending}>
          {action.pending ? <Spinner /> : null} Registrar {CASH_MOVEMENT_LABELS[type].toLowerCase()}
        </Button>
      </form>
      <ApprovalDialog
        {...action.approvalProps}
        description={
          type === 'WITHDRAWAL'
            ? 'Los retiros los autoriza un administrador: pídele que digite su PIN.'
            : 'El egreso supera el tope permitido: pide a un administrador que digite su PIN.'
        }
      />
    </DialogContent>
  );
}

// ── Cierre con arqueo ──────────────────────────────────────────────

interface CloseShiftDialogProps extends DialogProps {
  shift: CashShift;
  /** La cajera terminó de ver el resultado: la caja ya está cerrada. */
  onClosed: () => void;
}

export function CloseShiftDialog({ open, onOpenChange, shift, onClosed }: CloseShiftDialogProps) {
  const [result, setResult] = useState<CashShift | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Una vez cerrada, el único camino es "Listo".
        if (result === null) onOpenChange(next);
      }}
    >
      {open && result === null ? <CountForm shift={shift} onClosed={setResult} /> : null}
      {open && result !== null ? <ClosedSummary shift={result} onDone={onClosed} /> : null}
    </Dialog>
  );
}

function CountForm({
  shift,
  onClosed,
}: {
  shift: CashShift;
  onClosed: (closed: CashShift) => void;
}) {
  const [quantities, setQuantities] = useState<Partial<Record<Denomination, number>>>({});
  const [note, setNote] = useState('');

  const counts = DENOMINATIONS.flatMap((denomination) => {
    const quantity = quantities[denomination] ?? 0;
    return quantity > 0 ? [{ denomination, quantity }] : [];
  });
  const counted = countDenominations(counts);
  const expected = shift.summary.expectedCash;
  const difference = cashDifference(counted, expected);
  const noteMissing = difference !== 0 && note.trim() === '';

  const close = useMutation({
    mutationFn: () => closeShift({ counts, note: note.trim() }),
    onSuccess: onClosed,
  });

  const setQuantity = (denomination: Denomination, value: number) => {
    setQuantities((current) => ({
      ...current,
      [denomination]: Math.max(0, Math.min(99_999, value)),
    }));
  };

  return (
    <DialogContent
      title="Cerrar caja"
      description="Cuenta los billetes y monedas del cajón. Después de cerrar no se pueden registrar más ventas en esta caja."
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!noteMissing) close.mutate();
        }}
        noValidate
      >
        <ul className="grid gap-1.5" aria-label="Conteo por denominación">
          {DENOMINATIONS.map((denomination) => {
            const quantity = quantities[denomination] ?? 0;
            const inputId = `count-${String(denomination)}`;
            return (
              <li key={denomination} className="flex items-center gap-2">
                <label htmlFor={inputId} className="w-24 text-sm font-bold tabular-nums">
                  {formatCOP(denomination)}
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Quitar uno de ${formatCOP(denomination)}`}
                  disabled={quantity === 0}
                  onClick={() => {
                    setQuantity(denomination, quantity - 1);
                  }}
                >
                  <Minus aria-hidden="true" />
                </Button>
                <Input
                  id={inputId}
                  inputMode="numeric"
                  autoComplete="off"
                  className="h-11 w-16 text-center font-bold"
                  value={quantity === 0 ? '' : String(quantity)}
                  placeholder="0"
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, '').slice(0, 5);
                    setQuantity(denomination, digits === '' ? 0 : Number(digits));
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Agregar uno de ${formatCOP(denomination)}`}
                  onClick={() => {
                    setQuantity(denomination, quantity + 1);
                  }}
                >
                  <Plus aria-hidden="true" />
                </Button>
                <span className="ml-auto text-sm text-muted-foreground tabular-nums">
                  {formatCOP(denomination * quantity)}
                </span>
              </li>
            );
          })}
        </ul>

        <dl className="grid gap-1 rounded-xl bg-muted p-3 text-sm">
          <div className="flex justify-between">
            <dt>Contado</dt>
            <dd className="font-extrabold tabular-nums">{formatCOP(counted)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Esperado</dt>
            <dd className="font-bold tabular-nums">{formatCOP(expected)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{differenceLabel(difference)}</dt>
            <dd className={cn('font-extrabold tabular-nums', difference !== 0 && 'text-danger')}>
              {formatCOP(Math.abs(difference))}
            </dd>
          </div>
        </dl>

        {difference === 0 ? null : (
          <Field
            id="closing-note"
            label="Nota obligatoria"
            hint="Explica el sobrante o faltante; queda registrado en la auditoría."
          >
            <Input
              id="closing-note"
              maxLength={300}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </Field>
        )}
        {close.isError ? <Alert tone="danger">{errorMessage(close.error)}</Alert> : null}
        <Button type="submit" size="lg" disabled={close.isPending || noteMissing}>
          {close.isPending ? <Spinner /> : <Lock aria-hidden="true" />} Cerrar caja
        </Button>
      </form>
    </DialogContent>
  );
}

function differenceLabel(difference: number): string {
  if (difference === 0) return 'Cuadra exacto';
  return difference > 0 ? 'Sobrante' : 'Faltante';
}

function ClosedSummary({ shift, onDone }: { shift: CashShift; onDone: () => void }) {
  const closing = shift.closing;
  return (
    <DialogContent title="Caja cerrada" hideClose>
      <div className="grid justify-items-center gap-3 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent-soft-foreground">
          <CheckCircle2 className="size-7" aria-hidden="true" />
        </span>
        {closing === null ? null : (
          <>
            <p className="text-sm text-muted-foreground">
              Contaste {formatCOP(closing.countedCash)} y el sistema esperaba{' '}
              {formatCOP(closing.expectedCash)}.
            </p>
            <p className="text-xl font-extrabold">
              {differenceLabel(closing.difference)}
              {closing.difference === 0 ? '' : `: ${formatCOP(Math.abs(closing.difference))}`}
            </p>
          </>
        )}
        <Button size="lg" className="w-full" onClick={onDone}>
          Listo
        </Button>
      </div>
    </DialogContent>
  );
}
