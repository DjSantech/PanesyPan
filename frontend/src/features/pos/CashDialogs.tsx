import {
  CASH_MOVEMENT_LABELS,
  CASH_MOVEMENT_TYPES,
  cashDifference,
  countDenominations,
  createCashMovementRequestSchema,
  DENOMINATIONS,
  formatCOP,
  formatTimeCO,
  slugify,
  type CashMovement,
  type CashMovementType,
  type CashShift,
  type Denomination,
  type Supplier,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bike,
  CheckCircle2,
  Ellipsis,
  Flame,
  Lock,
  Minus,
  Plus,
  Snowflake,
  Truck,
  Zap,
} from 'lucide-react';
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
import { listSuppliers, suppliersKeys } from '../suppliers/suppliers.api';
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

/** En qué se gastó: los atajos más comunes de la panadería, en botones grandes. */
const EXPENSE_KINDS = [
  { id: 'supplier', label: 'Proveedor', icon: Truck },
  { id: 'gas', label: 'Gas', icon: Flame },
  { id: 'ice', label: 'Hielo', icon: Snowflake },
  { id: 'delivery', label: 'Domicilio', icon: Bike },
  { id: 'services', label: 'Servicios', icon: Zap },
  { id: 'other', label: 'Otro', icon: Ellipsis },
] as const;
type ExpenseKind = (typeof EXPENSE_KINDS)[number]['id'];

interface MovementErrors {
  amount?: string;
  reason?: string;
  supplier?: string;
}

function MovementForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<CashMovementType>('EXPENSE');
  const [kind, setKind] = useState<ExpenseKind>('supplier');
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<MovementErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  const suppliers = useQuery({
    queryKey: suppliersKeys.list({ status: 'active' }),
    queryFn: ({ signal }) => listSuppliers({ status: 'active' }, signal),
  });
  const isExpense = type === 'EXPENSE';
  const payingSupplier = isExpense && kind === 'supplier';
  const term = slugify(supplierSearch);
  const shownSuppliers = (suppliers.data ?? []).filter(
    (item) => term === '' || slugify(item.name).includes(term),
  );

  // El motivo se arma solo con lo que se eligió: "Pago a Alpina · factura 123".
  const kindLabel = EXPENSE_KINDS.find((item) => item.id === kind)?.label ?? '';
  const baseReason = !isExpense
    ? ''
    : payingSupplier
      ? supplier === null
        ? ''
        : `Pago a ${supplier.name}`
      : kind === 'other'
        ? ''
        : kindLabel;
  const reason = [baseReason, note.trim()].filter(Boolean).join(' · ');

  const action = useApprovedAction<CashMovement>({
    run: (pin) =>
      createMovement({
        type,
        amount: amount ?? 0,
        reason,
        ...(payingSupplier && supplier !== null ? { supplierId: supplier.id } : {}),
        ...(pin === undefined ? {} : { approverPin: pin }),
      }),
    onSuccess: (movement) => {
      void queryClient.invalidateQueries({ queryKey: posKeys.shift });
      void queryClient.invalidateQueries({ queryKey: posKeys.movements });
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
    const next: MovementErrors = {};
    if (payingSupplier && supplier === null) next.supplier = 'Elige a quién le pagas';
    const parsed = createCashMovementRequestSchema.safeParse({
      type,
      amount: amount ?? 0,
      reason,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'amount' || key === 'reason') && next[key] === undefined) {
          next[key] = issue.message;
        }
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
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
                setErrors({});
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

        {isExpense ? (
          <div className="grid gap-2">
            <p className="text-sm font-bold">¿En qué fue?</p>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="En qué se gastó">
              {EXPENSE_KINDS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={kind === id}
                  onClick={() => {
                    setKind(id);
                    setErrors({});
                  }}
                  className={cn(
                    'flex h-20 flex-col items-center justify-center gap-1 rounded-xl border text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                    kind === id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card text-foreground hover:bg-muted',
                  )}
                >
                  <Icon className="size-6" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Gasto menor pagado con la caja. Sobre el tope de Ajustes pide la autorización de un
              administrador.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Efectivo que se saca para guardarlo. Siempre lo autoriza un administrador.
          </p>
        )}

        {payingSupplier ? (
          <div className="grid gap-2">
            <p className="text-sm font-bold">¿A quién le pagas?</p>
            {supplier === null ? (
              <>
                <Input
                  type="search"
                  aria-label="Buscar proveedor"
                  placeholder="Buscar proveedor…"
                  value={supplierSearch}
                  onChange={(event) => {
                    setSupplierSearch(event.target.value);
                  }}
                />
                {suppliers.isPending ? (
                  <Spinner label="Cargando proveedores…" />
                ) : suppliers.isError ? (
                  <Alert tone="danger">{errorMessage(suppliers.error)}</Alert>
                ) : shownSuppliers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {suppliers.data.length === 0
                      ? 'Todavía no hay proveedores: pídele al administrador que los cree en Proveedores.'
                      : 'No se encontró ese proveedor.'}
                  </p>
                ) : (
                  <ul className="grid max-h-44 gap-1.5 overflow-y-auto" aria-label="Proveedores">
                    {shownSuppliers.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSupplier(item);
                            setErrors({});
                          }}
                          className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-border bg-card px-3 text-left text-sm font-bold hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                        >
                          <Truck className="size-4 text-muted-foreground" aria-hidden="true" />
                          {item.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-primary bg-primary/10 px-3 py-2">
                <p className="flex items-center gap-2 font-extrabold text-primary">
                  <Truck className="size-4" aria-hidden="true" /> {supplier.name}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSupplier(null);
                  }}
                >
                  Cambiar
                </Button>
              </div>
            )}
            {errors.supplier === undefined ? null : (
              <p role="alert" className="text-sm font-bold text-danger">
                {errors.supplier}
              </p>
            )}
          </div>
        ) : null}

        <Field id="movement-amount" label="Monto" error={errors.amount}>
          <PriceInput
            id="movement-amount"
            className="h-14 text-2xl"
            value={amount}
            onValueChange={setAmount}
            aria-invalid={errors.amount === undefined ? undefined : true}
          />
        </Field>
        <Field
          id="movement-note"
          label={baseReason === '' ? 'Motivo' : 'Nota (opcional)'}
          error={errors.reason}
        >
          <Input
            id="movement-note"
            maxLength={120}
            placeholder={
              !isExpense
                ? 'Ej.: guardar en la caja fuerte'
                : payingSupplier
                  ? 'Ej.: factura 1234'
                  : kind === 'other'
                    ? 'Ej.: bolsas para domicilios'
                    : 'Ej.: pagado a Juan'
            }
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
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
