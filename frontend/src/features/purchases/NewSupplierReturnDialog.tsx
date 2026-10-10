import {
  createSupplierReturnRequestSchema,
  formatCOP,
  purchaseTotalOf,
  SUPPLIER_REFUND_LABELS,
  SUPPLIER_REFUND_METHODS,
  type SupplierRefundMethod,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Spinner } from '@/components/feedback';
import { PriceInput } from '@/components/PriceInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { catalogKeys, listProducts } from '../catalog/catalog.api';
import { inventoryKeys } from '../inventory/inventory.api';
import { posKeys } from '../pos/pos.api';
import { createSupplierReturn, purchaseKeys, useSuppliers } from './purchases.api';

interface DraftLine {
  key: number;
  productId: string;
  quantity: string;
  unitCost: number | null;
}

let nextKey = 1;
const emptyLine = (): DraftLine => ({
  key: nextKey++,
  productId: '',
  quantity: '1',
  unitCost: null,
});

interface NewSupplierReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewSupplierReturnDialog({ open, onOpenChange }: NewSupplierReturnDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ReturnForm
          onDone={() => {
            onOpenChange(false);
          }}
        />
      ) : null}
    </Dialog>
  );
}

function ReturnForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();
  const products = useQuery({
    queryKey: catalogKeys.products({ status: 'active' }),
    queryFn: ({ signal }) => listProducts({ status: 'active' }, signal),
  });
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [emptyLine()]);
  const [refundMethod, setRefundMethod] = useState<SupplierRefundMethod>('CASH_DRAWER');
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const productList = [...(products.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const productById = new Map(productList.map((product) => [product.id, product]));
  const total = purchaseTotalOf(
    lines.map((line) => ({ quantity: Number(line.quantity) || 0, unitCost: line.unitCost ?? 0 })),
  );
  const toInput = () => ({
    supplierId,
    lines: lines.map((line) => ({
      productId: line.productId,
      quantity: Number(line.quantity),
      unitCost: line.unitCost ?? Number.NaN,
    })),
    refundMethod,
    note: note.trim(),
  });

  const updateLine = (key: number, change: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  };

  const mutation = useMutation({
    mutationFn: createSupplierReturn,
    onSuccess: (entry) => {
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      void queryClient.invalidateQueries({ queryKey: posKeys.shift });
      void queryClient.invalidateQueries({ queryKey: posKeys.movements });
      toast.success(
        `Devolución N.º ${String(entry.number)} registrada por ${formatCOP(entry.total)}`,
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
    const parsed = createSupplierReturnRequestSchema.safeParse(toInput());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setFailure(
        issue?.path[0] === 'supplierId'
          ? 'Elige el proveedor'
          : issue?.path.includes('productId') === true
            ? 'Elige el producto de cada línea'
            : (issue?.message ?? 'Revisa los datos de la devolución'),
      );
      return;
    }
    mutation.mutate(toInput());
  };

  return (
    <DialogContent
      title="Devolución a proveedor"
      description="Mercancía que se le devuelve al proveedor: baja el stock y registra cómo se reintegra el valor."
      className="sm:max-w-2xl"
    >
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        <Field id="return-supplier" label="Proveedor">
          <NativeSelect
            id="return-supplier"
            value={supplierId}
            onChange={(event) => {
              setSupplierId(event.target.value);
            }}
          >
            <option value="">Elige el proveedor</option>
            {(suppliers.data ?? []).map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-bold">Productos devueltos</legend>
          {lines.map((line, index) => {
            const n = String(index + 1);
            return (
              <div
                key={line.key}
                className="grid gap-2 rounded-xl border border-border p-2 sm:grid-cols-[1fr_5rem_8rem_auto]"
              >
                <NativeSelect
                  aria-label={`Producto de la línea ${n}`}
                  value={line.productId}
                  onChange={(event) => {
                    const product = productById.get(event.target.value);
                    updateLine(line.key, {
                      productId: event.target.value,
                      // Se propone el último costo del producto.
                      ...(product?.cost === undefined ||
                      product.cost === null ||
                      line.unitCost !== null
                        ? {}
                        : { unitCost: product.cost }),
                    });
                  }}
                >
                  <option value="">Elige un producto</option>
                  {productList.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </NativeSelect>
                <Input
                  aria-label={`Cantidad de la línea ${n}`}
                  inputMode="numeric"
                  value={line.quantity}
                  onChange={(event) => {
                    updateLine(line.key, {
                      quantity: event.target.value.replace(/\D/g, '').slice(0, 5),
                    });
                  }}
                />
                <PriceInput
                  aria-label={`Costo unitario de la línea ${n}`}
                  value={line.unitCost}
                  onValueChange={(unitCost) => {
                    updateLine(line.key, { unitCost });
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Quitar la línea ${n}`}
                  disabled={lines.length <= 1}
                  onClick={() => {
                    setLines((current) => current.filter((item) => item.key !== line.key));
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => {
              setLines((current) => [...current, emptyLine()]);
            }}
          >
            <Plus aria-hidden="true" /> Agregar producto
          </Button>
        </fieldset>

        <div className="grid gap-2">
          <p className="text-sm font-bold">¿Cómo reintegra el proveedor?</p>
          <div
            className="grid grid-cols-2 rounded-xl bg-muted p-1"
            role="radiogroup"
            aria-label="Forma de reintegro"
          >
            {SUPPLIER_REFUND_METHODS.map((method) => (
              <button
                key={method}
                type="button"
                role="radio"
                aria-checked={refundMethod === method}
                onClick={() => {
                  setRefundMethod(method);
                }}
                className={cn(
                  'h-11 rounded-lg text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  refundMethod === method ? 'bg-card shadow-xs' : 'text-muted-foreground',
                )}
              >
                {SUPPLIER_REFUND_LABELS[method]}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {refundMethod === 'CASH_DRAWER'
              ? 'El efectivo entra a tu caja abierta como un ingreso de tipo Reintegro.'
              : 'No toca la caja: queda solo como devolución.'}
          </p>
        </div>

        <Field id="return-note" label="Nota (opcional)">
          <Input
            id="return-note"
            maxLength={200}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </Field>

        <p className="flex justify-between rounded-xl bg-muted px-4 py-3 text-lg">
          <span className="font-bold">Total a reintegrar</span>
          <span className="font-extrabold tabular-nums">{formatCOP(total)}</span>
        </p>
        {failure === null ? null : <Alert tone="danger">{failure}</Alert>}
        <Button type="submit" size="lg" disabled={mutation.isPending}>
          {mutation.isPending ? <Spinner /> : null} Registrar devolución
        </Button>
      </form>
    </DialogContent>
  );
}
