import { formatCOP } from '@panesypan/shared';
import { Minus, Plus, ShoppingBasket, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface OrderLineView {
  key: string;
  name: string;
  note: string;
  unitPrice: number;
  quantity: number;
  total: number;
  /** El producto se agotó o se archivó después de agregarlo. */
  unavailable?: boolean;
}

interface OrderPanelProps {
  title: string;
  subtitle?: ReactNode;
  /** En el celular el panel va dentro de un diálogo que ya muestra el título. */
  hideHeader?: boolean;
  lines: OrderLineView[];
  total: number;
  busy?: boolean;
  emptyText: string;
  onChangeQuantity: (key: string, quantity: number) => void;
  /** Botones de abajo (cobrar, cancelar…). */
  children?: ReactNode;
  className?: string;
}

const stepButton =
  'grid size-11 place-items-center rounded-xl border border-border bg-card hover:bg-muted active:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50';

/** Pedido en curso: líneas con cantidad táctil, total grande y acciones. */
export function OrderPanel({
  title,
  subtitle,
  hideHeader = false,
  lines,
  total,
  busy = false,
  emptyText,
  onChangeQuantity,
  children,
  className,
}: OrderPanelProps) {
  const units = lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <section
      aria-label={title}
      className={cn(
        'flex min-h-0 flex-col rounded-2xl border border-border bg-card shadow-xs',
        className,
      )}
    >
      {hideHeader ? null : (
        <header className="grid gap-0.5 border-b border-border p-4">
          <h2 className="truncate text-lg font-extrabold">{title}</h2>
          {subtitle === undefined ? null : (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </header>
      )}

      {lines.length === 0 ? (
        <div className="grid flex-1 place-items-center gap-2 p-8 text-center text-muted-foreground">
          <ShoppingBasket className="size-8" aria-hidden="true" />
          <p className="text-sm font-semibold">{emptyText}</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" aria-busy={busy}>
          {lines.map((line) => (
            <li key={line.key} className="grid gap-2 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="leading-tight font-bold">{line.name}</p>
                  {line.note === '' ? null : (
                    <p className="text-sm text-muted-foreground">{line.note}</p>
                  )}
                  {line.unavailable === true ? (
                    <p className="text-sm font-bold text-danger">Ya no está disponible</p>
                  ) : null}
                </div>
                <p className="shrink-0 font-extrabold">{formatCOP(line.total)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={stepButton}
                  disabled={busy}
                  aria-label={`Quitar uno de ${line.name}`}
                  onClick={() => {
                    onChangeQuantity(line.key, line.quantity - 1);
                  }}
                >
                  <Minus className="size-5" aria-hidden="true" />
                </button>
                <span
                  className="min-w-8 text-center text-lg font-extrabold"
                  aria-label={`Cantidad de ${line.name}`}
                >
                  {line.quantity}
                </span>
                <button
                  type="button"
                  className={stepButton}
                  disabled={busy || line.unavailable === true}
                  aria-label={`Agregar uno de ${line.name}`}
                  onClick={() => {
                    onChangeQuantity(line.key, line.quantity + 1);
                  }}
                >
                  <Plus className="size-5" aria-hidden="true" />
                </button>
                <span className="ml-1 text-sm text-muted-foreground">
                  {formatCOP(line.unitPrice)} c/u
                </span>
                <button
                  type="button"
                  className={cn(
                    stepButton,
                    'ml-auto border-transparent text-muted-foreground hover:text-danger',
                  )}
                  disabled={busy}
                  aria-label={`Quitar ${line.name}`}
                  onClick={() => {
                    onChangeQuantity(line.key, 0);
                  }}
                >
                  <Trash2 className="size-5" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="grid gap-3 border-t border-border p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-bold text-muted-foreground">
            Total{units > 0 ? ` · ${String(units)} ${units === 1 ? 'producto' : 'productos'}` : ''}
          </span>
          <span className="text-3xl font-extrabold" aria-live="polite">
            {formatCOP(total)}
          </span>
        </div>
        {children}
      </footer>
    </section>
  );
}
