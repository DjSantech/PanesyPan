import {
  formatCOP,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  returnAmountOf,
  SALE_LIMITS,
  type PaymentMethod,
  type Sale,
} from '@panesypan/shared';
import { Minus, Plus } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { ApprovalDialog } from '../pos/ApprovalDialog';
import { returnSale } from '../pos/pos.api';
import { formatSaleNumber } from '../pos/receipt-format';
import { useApprovedAction } from '../pos/use-approved-action';

/** Unidades de cada línea que todavía se pueden devolver. */
function remainingByLine(sale: Sale): Map<string, number> {
  const returned = new Map<string, number>();
  for (const entry of sale.returns) {
    for (const line of entry.lines) {
      returned.set(line.lineId, (returned.get(line.lineId) ?? 0) + line.quantity);
    }
  }
  return new Map(sale.lines.map((line) => [line.id, line.quantity - (returned.get(line.id) ?? 0)]));
}

/** Devolver algunos productos de una venta pagada (sin anularla completa). */
export function ReturnForm({
  sale,
  onBack,
  onReturned,
}: {
  sale: Sale;
  onBack: () => void;
  onReturned: (sale: Sale) => void;
}) {
  const remaining = remainingByLine(sale);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('CASH');
  const [error, setError] = useState<string | null>(null);

  const chosen = sale.lines.flatMap((line) => {
    const quantity = quantities[line.id] ?? 0;
    return quantity > 0 ? [{ line, quantity }] : [];
  });
  const amount = chosen.reduce(
    (sum, { line, quantity }) => sum + returnAmountOf(line, quantity, sale),
    0,
  );
  const valid = chosen.length > 0 && reason.trim().length >= SALE_LIMITS.reasonMin;

  const action = useApprovedAction<Sale>({
    run: (pin) =>
      returnSale(sale.id, {
        lines: chosen.map(({ line, quantity }) => ({ lineId: line.id, quantity })),
        reason: reason.trim(),
        refundMethod,
        ...(pin === undefined ? {} : { approverPin: pin }),
      }),
    onSuccess: onReturned,
    onError: (failure) => {
      setError(errorMessage(failure));
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid) return;
    setError(null);
    action.execute();
  };

  return (
    <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
      <ul className="grid gap-2" aria-label="Productos de la venta">
        {sale.lines.map((line) => {
          const left = remaining.get(line.id) ?? 0;
          const quantity = quantities[line.id] ?? 0;
          const set = (value: number) => {
            setQuantities((current) => ({
              ...current,
              [line.id]: Math.max(0, Math.min(left, value)),
            }));
          };
          return (
            <li key={line.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-bold">{line.name}</span>
                <span className="block text-muted-foreground">
                  {left === 0 ? 'Ya se devolvió completo' : `Se pueden devolver ${String(left)}`}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Devolver uno menos de ${line.name}`}
                disabled={quantity === 0}
                onClick={() => {
                  set(quantity - 1);
                }}
              >
                <Minus aria-hidden="true" />
              </Button>
              <span className="w-6 text-center font-extrabold tabular-nums">{quantity}</span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`Devolver uno más de ${line.name}`}
                disabled={quantity >= left}
                onClick={() => {
                  set(quantity + 1);
                }}
              >
                <Plus aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
      <Field id="return-method" label="¿Cómo se le devuelve el dinero?">
        <NativeSelect
          id="return-method"
          value={refundMethod}
          onChange={(event) => {
            setRefundMethod(event.target.value as PaymentMethod);
          }}
        >
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {PAYMENT_METHOD_LABELS[method]}
              {method === 'CASH' ? ' (sale de tu caja)' : ''}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id="return-reason" label="Motivo de la devolución">
        <Input
          id="return-reason"
          maxLength={SALE_LIMITS.reasonMax}
          placeholder="Ej.: el pan venía quemado"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </Field>
      <Alert tone="pending">
        Se le devuelven {formatCOP(amount)} al cliente y los productos vuelven al inventario. Lo
        autoriza un administrador y queda en la auditoría.
      </Alert>
      {error === null ? null : <Alert tone="danger">{error}</Alert>}
      <DialogFooter className="mt-0">
        <Button variant="outline" onClick={onBack} disabled={action.pending}>
          Volver
        </Button>
        <Button type="submit" disabled={!valid || action.pending}>
          {action.pending ? <Spinner /> : null} Devolver {formatCOP(amount)}
        </Button>
      </DialogFooter>
      <ApprovalDialog
        {...action.approvalProps}
        description={`Devolución de la venta N.º ${formatSaleNumber(sale.number)}: pide a un administrador que digite su PIN.`}
      />
    </form>
  );
}
