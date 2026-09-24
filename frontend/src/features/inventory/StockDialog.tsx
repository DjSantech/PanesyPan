import {
  adjustStockRequestSchema,
  registerProductionRequestSchema,
  registerWasteRequestSchema,
  setMinStockRequestSchema,
  WASTE_REASON_LABELS,
  WASTE_REASONS,
  type InventoryItem,
  type WasteReason,
} from '@panesypan/shared';
import { useState, type SubmitEvent } from 'react';
import { Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { fieldAria } from '@/components/ui/field-aria';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';

export type StockDialogMode = 'production' | 'waste' | 'adjust' | 'min';

export interface StockDialogValues {
  quantity: number;
  reason: WasteReason;
  note: string;
}

interface ModeCopy {
  title: string;
  description: string;
  quantityLabel: string;
  quantityHint?: string;
  submit: string;
  hasNote: boolean;
  noteLabel: string;
}

const COPY: Record<StockDialogMode, ModeCopy> = {
  production: {
    title: 'Registrar producción',
    description: 'Unidades que salieron del horno y se suman al inventario.',
    quantityLabel: 'Unidades producidas',
    submit: 'Registrar producción',
    hasNote: true,
    noteLabel: 'Nota (opcional)',
  },
  waste: {
    title: 'Registrar merma',
    description: 'Unidades que se pierden y salen del inventario.',
    quantityLabel: 'Unidades perdidas',
    submit: 'Registrar merma',
    hasNote: true,
    noteLabel: 'Nota (opcional)',
  },
  adjust: {
    title: 'Ajustar inventario',
    description:
      'Escribe lo que contaste: el stock queda en esa cantidad y se guarda la diferencia.',
    quantityLabel: 'Cantidad contada',
    submit: 'Guardar ajuste',
    hasNote: true,
    noteLabel: 'Motivo del ajuste',
  },
  min: {
    title: 'Stock mínimo',
    description:
      'Cuando el inventario llegue a esta cantidad se muestra la alerta. Con 0 no hay alerta.',
    quantityLabel: 'Avisar cuando queden',
    submit: 'Guardar mínimo',
    hasNote: false,
    noteLabel: '',
  },
};

type Errors = Partial<Record<'quantity' | 'reason' | 'note', string>>;

interface StockDialogProps {
  mode: StockDialogMode;
  item: InventoryItem;
  pending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: StockDialogValues) => void;
}

function initialQuantity(mode: StockDialogMode, item: InventoryItem): string {
  if (mode === 'adjust') return String(item.quantity);
  if (mode === 'min') return String(item.minStock);
  return '';
}

/** Un solo formulario para producción, merma, ajuste de conteo y stock mínimo. */
export function StockDialog({
  mode,
  item,
  pending,
  error,
  onOpenChange,
  onSubmit,
}: StockDialogProps) {
  const copy = COPY[mode];
  const [quantity, setQuantity] = useState(initialQuantity(mode, item));
  const [reason, setReason] = useState<WasteReason>('EXPIRED');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = quantity.trim() === '' ? Number.NaN : Number(quantity);
    const productId = item.productId;
    const parsed =
      mode === 'production'
        ? registerProductionRequestSchema.safeParse({ productId, quantity: amount, note })
        : mode === 'waste'
          ? registerWasteRequestSchema.safeParse({ productId, quantity: amount, reason, note })
          : mode === 'adjust'
            ? adjustStockRequestSchema.safeParse({ productId, newQuantity: amount, note })
            : setMinStockRequestSchema.safeParse({ minStock: amount });

    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        const field =
          key === 'quantity' || key === 'newQuantity' || key === 'minStock'
            ? 'quantity'
            : key === 'note' || key === 'reason'
              ? key
              : undefined;
        if (field !== undefined && next[field] === undefined) {
          next[field] =
            quantity.trim() === '' && field === 'quantity' ? 'Escribe la cantidad' : issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    onSubmit({ quantity: amount, reason, note: note.trim() });
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        title={`${copy.title} · ${item.name}`}
        description={`${copy.description} Ahora hay ${String(item.quantity)}.`}
      >
        <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
          <Field id="stock-quantity" label={copy.quantityLabel} error={errors.quantity}>
            <Input
              {...fieldAria('stock-quantity', errors.quantity)}
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={quantity}
              onChange={(event) => {
                setQuantity(event.target.value.replace(/\D/g, ''));
              }}
            />
          </Field>
          {mode === 'waste' ? (
            <Field id="stock-reason" label="Motivo" error={errors.reason}>
              <NativeSelect
                {...fieldAria('stock-reason', errors.reason)}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value as WasteReason);
                }}
              >
                {WASTE_REASONS.map((value) => (
                  <option key={value} value={value}>
                    {WASTE_REASON_LABELS[value]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          {copy.hasNote ? (
            <Field id="stock-note" label={copy.noteLabel} error={errors.note}>
              <Input
                {...fieldAria('stock-note', errors.note)}
                autoComplete="off"
                maxLength={200}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            </Field>
          ) : null}

          {error === null ? null : <Alert tone="danger">{error}</Alert>}

          <DialogFooter className="mt-1">
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
