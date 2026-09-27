import {
  computeSaleTotals,
  discountNeedsApproval,
  discountProblem,
  formatCOP,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  SALE_LIMITS,
  settlePayments,
  suggestedCashAmounts,
  type CustomerInput,
  type DiscountInput,
  type DiscountMode,
  type PaymentMethod,
  type Sale,
} from '@panesypan/shared';
import { BadgePercent, FileText, Split } from 'lucide-react';
import { useState, type ReactNode, type SubmitEvent } from 'react';
import { Spinner } from '@/components/feedback';
import { PriceInput } from '@/components/PriceInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';
import { ApiError, errorMessage } from '@/lib/api-errors';
import { newRequestId } from '@/lib/request-id';
import { cn } from '@/lib/utils';
import { CustomerFields } from '../einvoice/CustomerFields';
import { EMPTY_CUSTOMER, parseCustomer, type CustomerDraft } from '../einvoice/einvoice-logic';
import { ApprovalDialog } from './ApprovalDialog';
import { useApprovedAction } from './use-approved-action';

export interface CheckoutPayload {
  clientRequestId: string;
  expectedTotal: number;
  discount: DiscountInput | null;
  payments: { method: PaymentMethod; amount: number; reference: string }[];
  cashReceived: number | null;
  approverPin?: string;
  /** Cliente que pide la factura electrónica a su nombre. */
  customer?: CustomerInput;
}

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtotal: number;
  maxDiscountPercent: number;
  /** Quien cobra puede autorizar descuentos (administrador). */
  canApprove: boolean;
  submit: (payload: CheckoutPayload) => Promise<Sale>;
  onPaid: (sale: Sale) => void;
  /** El pedido cambió (precio, agotado…): se cierra el cobro para revisarlo. */
  onStale: (message: string) => void;
  /** Con facturación electrónica activa se puede facturar a nombre del cliente. */
  einvoiceEnabled?: boolean;
  /** Campos extra que se muestran antes del descuento y los pagos. */
  beforePayments?: ReactNode;
  /** Mientras sea true no se puede cobrar (p. ej. falta un campo extra). */
  blocked?: boolean;
}

/** Errores que significan "revisa el pedido" y no "reintenta el cobro". */
const STALE_CODES = new Set(['TOTAL_MISMATCH', 'OUT_OF_STOCK', 'NOT_FOUND', 'CONFLICT']);

export function CheckoutDialog(props: CheckoutDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <CheckoutForm {...props} /> : null}
    </Dialog>
  );
}

const segmented =
  'h-11 flex-1 rounded-lg px-3 text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none';

function CheckoutForm({
  onOpenChange,
  title,
  subtotal,
  maxDiscountPercent,
  canApprove,
  submit,
  onPaid,
  onStale,
  einvoiceEnabled = false,
  beforePayments = null,
  blocked = false,
}: CheckoutDialogProps) {
  const [requestId] = useState(newRequestId);
  const [discountOn, setDiscountOn] = useState(false);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('PERCENT');
  const [discountValue, setDiscountValue] = useState<number | null>(null);
  const [discountReason, setDiscountReason] = useState('');
  const [split, setSplit] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [received, setReceived] = useState<number | null>(null);
  const [reference, setReference] = useState('');
  const [splitAmounts, setSplitAmounts] = useState<Partial<Record<PaymentMethod, number | null>>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [customerOn, setCustomerOn] = useState(false);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(EMPTY_CUSTOMER);
  const [customerError, setCustomerError] = useState<string | null>(null);

  const discount =
    discountOn && discountValue !== null && discountValue > 0
      ? { mode: discountMode, value: discountValue }
      : null;
  const totals = computeSaleTotals([{ unitPrice: subtotal, quantity: 1 }], discount);
  const discountError =
    discountMode === 'PERCENT' && (discountValue ?? 0) > 100
      ? 'El porcentaje máximo es 100 %'
      : discountProblem(totals);
  const needsApproval =
    discount !== null && !canApprove && discountNeedsApproval(totals, maxDiscountPercent);

  const payments = split
    ? PAYMENT_METHODS.flatMap((item) => {
        const amount = splitAmounts[item] ?? 0;
        return amount > 0 ? [{ method: item, amount, reference: '' }] : [];
      })
    : [{ method, amount: totals.total, reference: method === 'CASH' ? '' : reference.trim() }];
  const cashPart = payments.find((payment) => payment.method === 'CASH')?.amount ?? 0;
  const settlement = settlePayments(totals.total, payments, cashPart > 0 ? received : null);
  const paidSoFar = payments.reduce((sum, payment) => sum + payment.amount, 0);

  const reasonMissing = discount !== null && discountReason.trim().length < SALE_LIMITS.reasonMin;
  const canSubmit =
    !blocked && totals.total > 0 && discountError === null && !reasonMissing && settlement.ok;

  const customer = customerOn ? parseCustomer(customerDraft) : null;

  const action = useApprovedAction<Sale>({
    run: (pin) =>
      submit({
        ...(customer?.ok === true ? { customer: customer.value } : {}),
        clientRequestId: requestId,
        expectedTotal: totals.total,
        discount: discount === null ? null : { ...discount, reason: discountReason.trim() },
        payments,
        cashReceived: cashPart > 0 ? received : null,
        ...(pin === undefined ? {} : { approverPin: pin }),
      }),
    onSuccess: onPaid,
    onError: (failure) => {
      if (failure instanceof ApiError && STALE_CODES.has(failure.code)) {
        onStale(failure.message);
        return;
      }
      setError(errorMessage(failure));
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || action.pending) return;
    if (customer !== null && !customer.ok) {
      setCustomerError(customer.message);
      return;
    }
    setCustomerError(null);
    setError(null);
    if (needsApproval) action.askForPin();
    else action.execute();
  };

  return (
    <DialogContent title={title} className="sm:max-w-lg">
      <form className="grid gap-5" onSubmit={handleSubmit} noValidate>
        <div className="rounded-2xl bg-muted p-4 text-center">
          <p className="text-sm font-bold text-muted-foreground">Total a cobrar</p>
          <p className="text-4xl font-extrabold" aria-live="polite">
            {formatCOP(totals.total)}
          </p>
          {totals.discount > 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {formatCOP(totals.subtotal)} − descuento {formatCOP(totals.discount)}
            </p>
          ) : null}
        </div>

        {beforePayments}

        {/* ── Descuento ── */}
        {discountOn ? (
          <fieldset className="grid gap-3 rounded-2xl border border-border p-3">
            <legend className="px-1 text-sm font-bold">Descuento</legend>
            <div className="flex gap-2">
              <div
                className="inline-flex flex-1 rounded-xl bg-muted p-1"
                role="radiogroup"
                aria-label="Tipo de descuento"
              >
                {(['PERCENT', 'AMOUNT'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={discountMode === mode}
                    className={cn(
                      segmented,
                      discountMode === mode ? 'bg-card shadow-xs' : 'text-muted-foreground',
                    )}
                    onClick={() => {
                      setDiscountMode(mode);
                      setDiscountValue(null);
                    }}
                  >
                    {mode === 'PERCENT' ? 'Porcentaje' : 'Valor'}
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setDiscountOn(false);
                  setDiscountValue(null);
                  setDiscountReason('');
                }}
              >
                Quitar
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <Field
                id="discount-value"
                label={discountMode === 'PERCENT' ? 'Porcentaje' : 'Valor'}
                error={discountError}
              >
                {discountMode === 'PERCENT' ? (
                  <div className="relative">
                    <Input
                      id="discount-value"
                      inputMode="numeric"
                      autoComplete="off"
                      className="pr-8 font-bold"
                      value={discountValue === null ? '' : String(discountValue)}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/\D/g, '').slice(0, 3);
                        setDiscountValue(digits === '' ? null : Number(digits));
                      }}
                    />
                    <span
                      aria-hidden="true"
                      className="absolute top-1/2 right-3.5 -translate-y-1/2 font-bold text-muted-foreground"
                    >
                      %
                    </span>
                  </div>
                ) : (
                  <PriceInput
                    id="discount-value"
                    value={discountValue}
                    onValueChange={setDiscountValue}
                  />
                )}
              </Field>
              <Field
                id="discount-reason"
                label="Motivo"
                error={reasonMissing && discountReason !== '' ? 'Escribe el motivo' : null}
              >
                <Input
                  id="discount-reason"
                  placeholder="Ej.: cliente frecuente"
                  maxLength={SALE_LIMITS.reasonMax}
                  value={discountReason}
                  onChange={(event) => {
                    setDiscountReason(event.target.value);
                  }}
                />
              </Field>
            </div>
            <p
              className={cn(
                'text-sm',
                needsApproval ? 'font-bold text-pending' : 'text-muted-foreground',
              )}
            >
              {needsApproval
                ? `Supera el ${String(maxDiscountPercent)} %: pedirá el PIN de un administrador.`
                : `Hasta el ${String(maxDiscountPercent)} % sin autorización.`}
            </p>
          </fieldset>
        ) : null}

        {/* ── Medio de pago ── */}
        <fieldset className="grid gap-2">
          <legend className="mb-2 flex w-full items-center justify-between text-sm font-bold">
            Medio de pago
          </legend>
          {split ? null : (
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              role="radiogroup"
              aria-label="Medio de pago"
            >
              {PAYMENT_METHODS.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={method === item}
                  onClick={() => {
                    setMethod(item);
                    setReceived(null);
                  }}
                  className={cn(
                    'h-12 rounded-xl border-2 px-3 text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                    method === item
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card hover:bg-muted',
                  )}
                >
                  {PAYMENT_METHOD_LABELS[item]}
                </button>
              ))}
            </div>
          )}

          {split ? (
            <div className="grid gap-2">
              {PAYMENT_METHODS.map((item) => (
                <div key={item} className="grid grid-cols-[1fr_10rem] items-center gap-3">
                  <label htmlFor={`split-${item}`} className="text-sm font-bold">
                    {PAYMENT_METHOD_LABELS[item]}
                  </label>
                  <PriceInput
                    id={`split-${item}`}
                    value={splitAmounts[item] ?? null}
                    onValueChange={(value) => {
                      setSplitAmounts((current) => ({ ...current, [item]: value }));
                    }}
                  />
                </div>
              ))}
              <p
                className={cn(
                  'text-right text-sm font-bold',
                  paidSoFar === totals.total ? 'text-success' : 'text-pending',
                )}
                aria-live="polite"
              >
                {paidSoFar === totals.total
                  ? 'Los pagos cuadran con el total'
                  : paidSoFar < totals.total
                    ? `Falta ${formatCOP(totals.total - paidSoFar)}`
                    : `Sobra ${formatCOP(paidSoFar - totals.total)}`}
              </p>
            </div>
          ) : null}
        </fieldset>

        {cashPart > 0 ? (
          <div className="grid gap-2">
            <p className="text-sm font-bold">¿Con cuánto paga en efectivo?</p>
            <div className="flex flex-wrap gap-2">
              {suggestedCashAmounts(cashPart).map((amount) => (
                <Button
                  key={amount}
                  variant={
                    received === amount || (received === null && amount === cashPart)
                      ? 'default'
                      : 'outline'
                  }
                  className="h-12 min-w-24 text-base"
                  onClick={() => {
                    setReceived(amount);
                  }}
                >
                  {amount === cashPart ? 'Exacto' : formatCOP(amount)}
                </Button>
              ))}
            </div>
            <Field id="cash-received" label="Otro valor recibido">
              <PriceInput
                id="cash-received"
                value={received}
                onValueChange={setReceived}
                placeholder={formatCOP(cashPart)}
              />
            </Field>
          </div>
        ) : !split && method !== 'CASH' ? (
          <Field id="payment-reference" label="Referencia o comprobante (opcional)">
            <Input
              id="payment-reference"
              maxLength={40}
              autoComplete="off"
              value={reference}
              onChange={(event) => {
                setReference(event.target.value);
              }}
            />
          </Field>
        ) : null}

        {settlement.ok && cashPart > 0 ? (
          <div className="flex items-baseline justify-between rounded-2xl bg-success-soft px-4 py-3 text-success">
            <span className="font-bold">Cambio</span>
            <span className="text-3xl font-extrabold" aria-live="polite">
              {formatCOP(settlement.change)}
            </span>
          </div>
        ) : !settlement.ok && (split ? paidSoFar === totals.total : cashPart > 0) ? (
          <Alert tone="pending">{settlement.message}</Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {discountOn ? null : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDiscountOn(true);
              }}
            >
              <BadgePercent aria-hidden="true" /> Descuento
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            aria-pressed={split}
            onClick={() => {
              setSplit(!split);
              setReceived(null);
              setSplitAmounts({});
            }}
          >
            <Split aria-hidden="true" /> {split ? 'Un solo medio de pago' : 'Pago combinado'}
          </Button>
          {einvoiceEnabled ? (
            <Button
              variant="outline"
              size="sm"
              aria-pressed={customerOn}
              onClick={() => {
                setCustomerOn(!customerOn);
                setCustomerError(null);
              }}
            >
              <FileText aria-hidden="true" />{' '}
              {customerOn ? 'Consumidor final' : 'Factura a nombre del cliente'}
            </Button>
          ) : null}
        </div>

        {customerOn ? (
          <CustomerFields value={customerDraft} onChange={setCustomerDraft} error={customerError} />
        ) : null}

        {error === null ? null : <Alert tone="danger">{error}</Alert>}

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
          <Button type="submit" size="lg" disabled={!canSubmit || action.pending}>
            {action.pending ? <Spinner /> : null}
            Cobrar {formatCOP(totals.total)}
          </Button>
        </DialogFooter>
      </form>
      <ApprovalDialog
        {...action.approvalProps}
        description={`Descuento de ${formatCOP(totals.discount)}: pide a un administrador que digite su PIN.`}
      />
    </DialogContent>
  );
}
