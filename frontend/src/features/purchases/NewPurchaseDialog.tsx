import {
  createPurchaseRequestSchema,
  formatCOP,
  PURCHASE_PAYMENT_LABELS,
  PURCHASE_PAYMENT_METHODS,
  purchaseTotalOf,
  type Product,
  type Purchase,
  type PurchaseLineInput,
  type PurchasePaymentMethod,
} from '@panesypan/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { ApprovalDialog } from '../pos/ApprovalDialog';
import { posKeys } from '../pos/pos.api';
import { useApprovedAction } from '../pos/use-approved-action';
import { createPurchase, purchaseKeys, useSuppliers } from './purchases.api';

/** Valor del selector de producto para lo que no está en el catálogo. */
const OTHER = 'otro';

interface DraftLine {
  key: number;
  productId: string;
  description: string;
  quantity: string;
  unitCost: number | null;
}

let nextKey = 1;
const emptyLine = (): DraftLine => ({
  key: nextKey++,
  productId: '',
  description: '',
  quantity: '1',
  unitCost: null,
});

function toLineInput(line: DraftLine): PurchaseLineInput {
  const base = { quantity: Number(line.quantity), unitCost: line.unitCost ?? Number.NaN };
  return line.productId === OTHER || line.productId === ''
    ? { ...base, description: line.description.trim() }
    : { ...base, productId: line.productId };
}

interface NewPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewPurchaseDialog({ open, onOpenChange }: NewPurchaseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <PurchaseForm
          onDone={() => {
            onOpenChange(false);
          }}
        />
      ) : null}
    </Dialog>
  );
}

function PurchaseForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const suppliers = useSuppliers();
  const products = useQuery({
    queryKey: catalogKeys.products({ status: 'active' }),
    queryFn: ({ signal }) => listProducts({ status: 'active' }, signal),
  });
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [emptyLine()]);
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>('CASH_DRAWER');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const productList = [...(products.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const productById = new Map(productList.map((product) => [product.id, product]));
  const total = purchaseTotalOf(
    lines.map((line) => ({ quantity: Number(line.quantity) || 0, unitCost: line.unitCost ?? 0 })),
  );

  const updateLine = (key: number, change: Partial<DraftLine>) => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  };

  const action = useApprovedAction<Purchase>({
    run: (pin) =>
      createPurchase({
        supplierId,
        lines: lines.map(toLineInput),
        paymentMethod,
        reference: reference.trim(),
        note: note.trim(),
        ...(pin === undefined ? {} : { approverPin: pin }),
      }),
    onSuccess: (purchase) => {
      void queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
      void queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      void queryClient.invalidateQueries({ queryKey: catalogKeys.all });
      void queryClient.invalidateQueries({ queryKey: posKeys.shift });
      toast.success(
        `Compra N.º ${String(purchase.number)} registrada por ${formatCOP(purchase.total)}`,
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
    const parsed = createPurchaseRequestSchema.safeParse({
      supplierId,
      lines: lines.map(toLineInput),
      paymentMethod,
      reference,
      note,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setFailure(
        issue?.path[0] === 'supplierId'
          ? 'Elige el proveedor'
          : (issue?.message ?? 'Revisa los datos de la compra'),
      );
      return;
    }
    action.execute();
  };

  return (
    <DialogContent
      title="Nueva compra"
      description="Lo que llegó del proveedor. Los productos del catálogo suben su stock y quedan con este costo."
      className="sm:max-w-2xl"
    >
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        <Field id="purchase-supplier" label="Proveedor">
          <NativeSelect
            id="purchase-supplier"
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
          {suppliers.data?.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              No hay proveedores: el administrador los agrega en la pestaña Proveedores.
            </p>
          ) : null}
        </Field>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-bold">Artículos</legend>
          {lines.map((line, index) => (
            <LineRow
              key={line.key}
              index={index}
              line={line}
              products={productList}
              canRemove={lines.length > 1}
              onChange={(change) => {
                const product =
                  change.productId === undefined ? undefined : productById.get(change.productId);
                updateLine(line.key, {
                  ...change,
                  // Al elegir un producto se propone su último costo.
                  ...(product?.cost === undefined || product.cost === null || line.unitCost !== null
                    ? {}
                    : { unitCost: product.cost }),
                });
              }}
              onRemove={() => {
                setLines((current) => current.filter((item) => item.key !== line.key));
              }}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => {
              setLines((current) => [...current, emptyLine()]);
            }}
          >
            <Plus aria-hidden="true" /> Agregar artículo
          </Button>
        </fieldset>

        <div className="grid gap-2">
          <p className="text-sm font-bold">¿Cómo se pagó?</p>
          <div
            className="grid grid-cols-2 rounded-xl bg-muted p-1"
            role="radiogroup"
            aria-label="Forma de pago"
          >
            {PURCHASE_PAYMENT_METHODS.map((method) => (
              <button
                key={method}
                type="button"
                role="radio"
                aria-checked={paymentMethod === method}
                onClick={() => {
                  setPaymentMethod(method);
                }}
                className={cn(
                  'h-11 rounded-lg text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  paymentMethod === method ? 'bg-card shadow-xs' : 'text-muted-foreground',
                )}
              >
                {PURCHASE_PAYMENT_LABELS[method]}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {paymentMethod === 'CASH_DRAWER'
              ? 'Sale de tu caja abierta como un egreso de tipo Proveedor (no lo registres otra vez).'
              : 'No toca la caja: queda solo como compra.'}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="purchase-reference" label="Factura o referencia (opcional)">
            <Input
              id="purchase-reference"
              maxLength={60}
              value={reference}
              onChange={(event) => {
                setReference(event.target.value);
              }}
            />
          </Field>
          <Field id="purchase-note" label="Nota (opcional)">
            <Input
              id="purchase-note"
              maxLength={200}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
          </Field>
        </div>

        <p className="flex justify-between rounded-xl bg-muted px-4 py-3 text-lg">
          <span className="font-bold">Total</span>
          <span className="font-extrabold tabular-nums">{formatCOP(total)}</span>
        </p>
        {failure === null ? null : <Alert tone="danger">{failure}</Alert>}
        <Button type="submit" size="lg" disabled={action.pending}>
          {action.pending ? <Spinner /> : null} Registrar compra
        </Button>
      </form>
      <ApprovalDialog
        {...action.approvalProps}
        description="La compra supera el tope de egresos de la cajera: pide a un administrador que digite su PIN."
      />
    </DialogContent>
  );
}

function LineRow({
  index,
  line,
  products,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  line: DraftLine;
  products: Product[];
  canRemove: boolean;
  onChange: (change: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const n = String(index + 1);
  return (
    <div className="grid gap-2 rounded-xl border border-border p-2 sm:grid-cols-[1fr_5rem_8rem_auto]">
      <div className="grid gap-1.5">
        <NativeSelect
          aria-label={`Producto del artículo ${n}`}
          value={line.productId}
          onChange={(event) => {
            onChange({ productId: event.target.value });
          }}
        >
          <option value="">Elige un producto</option>
          <option value={OTHER}>Otro (insumo que no está en el catálogo)</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </NativeSelect>
        {line.productId === OTHER ? (
          <Input
            aria-label={`Qué se compró en el artículo ${n}`}
            placeholder="Ej.: Harina 50 kg"
            maxLength={80}
            value={line.description}
            onChange={(event) => {
              onChange({ description: event.target.value });
            }}
          />
        ) : null}
      </div>
      <Input
        aria-label={`Cantidad del artículo ${n}`}
        inputMode="numeric"
        value={line.quantity}
        onChange={(event) => {
          onChange({ quantity: event.target.value.replace(/\D/g, '').slice(0, 5) });
        }}
      />
      <PriceInput
        aria-label={`Costo unitario del artículo ${n}`}
        value={line.unitCost}
        onValueChange={(unitCost) => {
          onChange({ unitCost });
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Quitar el artículo ${n}`}
        disabled={!canRemove}
        onClick={onRemove}
      >
        <Trash2 />
      </Button>
    </div>
  );
}
