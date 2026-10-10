import {
  CASH_MOVEMENT_LABELS,
  cashMovementLabel,
  formatCOP,
  formatTimeCO,
  type CashMovement,
} from '@panesypan/shared';
import { cn } from '@/lib/utils';
import { ReceiptThumb } from './Receipt';

/** Movimientos de una caja con su foto de comprobante; los anulados se ven tachados. */
export function ShiftMovements({ movements }: { movements: CashMovement[] }) {
  if (movements.length === 0) return null;
  return (
    <section className="grid gap-1.5">
      <p className="text-sm font-bold">Movimientos</p>
      <ul className="grid gap-1.5">
        {movements.map((movement) => {
          const voided = movement.status === 'VOIDED';
          return (
            <li
              key={movement.id}
              className="flex items-start gap-3 rounded-xl bg-muted px-3 py-2 text-sm"
            >
              <ReceiptThumb receipt={movement.receipt} />
              <div className="min-w-0 flex-1">
                <p className={cn('font-bold', voided && 'line-through opacity-60')}>
                  {CASH_MOVEMENT_LABELS[movement.type]} · {cashMovementLabel(movement)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatTimeCO(new Date(movement.createdAt))} · {movement.createdBy}
                  {movement.approvedBy === null ? '' : ` · autorizó ${movement.approvedBy}`}
                </p>
                {voided ? (
                  <p className="text-xs font-bold text-danger">
                    Anulado{movement.voidedBy === null ? '' : ` por ${movement.voidedBy}`}
                    {movement.voidReason === null ? '' : `: ${movement.voidReason}`}
                  </p>
                ) : null}
              </div>
              <p className={cn('font-extrabold tabular-nums', voided && 'line-through opacity-60')}>
                {movement.type === 'INCOME' ? '+' : '−'}
                {formatCOP(movement.amount)}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
