import {
  formatCOP,
  PURCHASE_PAYMENT_LABELS,
  toBusinessDate,
  type OrderSuggestion,
  type Supplier,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCopy, MessageCircle, Plus, Truck } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/surface';
import { Switch } from '@/components/ui/toggles';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { useCan } from '../auth/use-session';
import { NewPurchaseDialog } from './NewPurchaseDialog';
import {
  createSupplier,
  getOrderSuggestions,
  listPurchases,
  purchaseKeys,
  updateSupplier,
  useSuppliers,
} from './purchases.api';

type Tab = 'purchases' | 'suppliers' | 'suggestions';

export function PurchasesPage() {
  const canManage = useCan('suppliers:manage');
  const [tab, setTab] = useState<Tab>('purchases');
  const tabs: { value: Tab; label: string }[] = canManage
    ? [
        { value: 'purchases', label: 'Compras' },
        { value: 'suppliers', label: 'Proveedores' },
        { value: 'suggestions', label: 'Pedido sugerido' },
      ]
    : [{ value: 'purchases', label: 'Compras' }];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Compras"
        description="Lo que llega de los proveedores: sube el stock, actualiza el costo y, si se paga con la caja, registra el egreso."
      />
      {tabs.length > 1 ? (
        <div
          role="tablist"
          aria-label="Secciones"
          className="mb-4 inline-flex rounded-xl bg-muted p-1"
        >
          {tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => {
                setTab(item.value);
              }}
              className={cn(
                'h-9 rounded-lg px-4 text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                tab === item.value ? 'bg-card shadow-xs' : 'text-muted-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {tab === 'purchases' ? <PurchasesTab /> : null}
      {tab === 'suppliers' ? <SuppliersTab /> : null}
      {tab === 'suggestions' ? <SuggestionsTab /> : null}
    </div>
  );
}

// ── Compras ────────────────────────────────────────────────────────

const monthStart = (): string => `${toBusinessDate().slice(0, 8)}01`;
/** AAAA-MM-DD → DD/MM/AAAA. */
const shortDate = (date: string): string => date.split('-').reverse().join('/');

function PurchasesTab() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => toBusinessDate());
  const [creating, setCreating] = useState(false);
  const validRange = from !== '' && to !== '' && from <= to;
  const purchases = useQuery({
    queryKey: purchaseKeys.list({ from, to }),
    queryFn: ({ signal }) => listPurchases({ from, to }, signal),
    enabled: validRange,
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="purchases-from" label="Desde">
          <Input
            id="purchases-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </Field>
        <Field id="purchases-to" label="Hasta">
          <Input
            id="purchases-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </Field>
        <Button
          className="ml-auto"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus aria-hidden="true" /> Nueva compra
        </Button>
      </div>

      {!validRange ? (
        <Alert tone="danger">La fecha inicial no puede ser posterior a la final.</Alert>
      ) : purchases.isPending ? (
        <Skeleton className="h-40" />
      ) : purchases.isError ? (
        <ErrorState
          description={errorMessage(purchases.error)}
          onRetry={() => void purchases.refetch()}
        />
      ) : purchases.data.items.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No hay compras en estas fechas"
          description="Registra lo que llega de los proveedores con Nueva compra."
        />
      ) : (
        <>
          <p className="text-sm">
            {purchases.data.items.length} compras ·{' '}
            <strong className="tabular-nums">{formatCOP(purchases.data.total)}</strong>
          </p>
          <ul className="grid gap-2">
            {purchases.data.items.map((purchase) => (
              <li key={purchase.id}>
                <Card className="grid gap-1 p-4">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-extrabold">
                      N.º {purchase.number} · {purchase.supplier.name}
                    </span>
                    <Badge>{PURCHASE_PAYMENT_LABELS[purchase.paymentMethod]}</Badge>
                    <span className="ml-auto text-lg font-extrabold tabular-nums">
                      {formatCOP(purchase.total)}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {shortDate(purchase.businessDate)} · registró {purchase.createdBy}
                    {purchase.approvedBy === null ? '' : ` · autorizó ${purchase.approvedBy}`}
                    {purchase.reference === '' ? '' : ` · ref. ${purchase.reference}`}
                  </p>
                  <p className="text-sm">
                    {purchase.lines
                      .map(
                        (line) =>
                          `${String(line.quantity)} × ${line.name} (${formatCOP(line.unitCost)})`,
                      )
                      .join(' · ')}
                  </p>
                  {purchase.note === '' ? null : (
                    <p className="text-sm text-muted-foreground">{purchase.note}</p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      <NewPurchaseDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

// ── Proveedores ────────────────────────────────────────────────────

function SuppliersTab() {
  const queryClient = useQueryClient();
  const suppliers = useSuppliers(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [taxId, setTaxId] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: purchaseKeys.all });
  const onError = (error: unknown) => {
    toast.error(errorMessage(error));
  };

  const create = useMutation({
    mutationFn: createSupplier,
    onSuccess: async (supplier) => {
      setName('');
      setPhone('');
      setTaxId('');
      await refresh();
      toast.success(`Proveedor "${supplier.name}" creado`);
    },
    onError,
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string; isActive?: boolean; phone?: string }) =>
      updateSupplier(id, input),
    onSuccess: refresh,
    onError,
  });

  const handleCreate = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      toast.error('El nombre debe tener al menos 2 caracteres');
      return;
    }
    create.mutate({ name, phone, taxId });
  };

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-2 rounded-2xl bg-muted p-3 sm:grid-cols-[1fr_1fr_1fr_auto]"
        onSubmit={handleCreate}
      >
        <Input
          aria-label="Nombre del proveedor"
          placeholder="Nombre (ej.: Surtiquesos)"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Input
          aria-label="Teléfono o WhatsApp"
          placeholder="Teléfono / WhatsApp"
          inputMode="tel"
          value={phone}
          onChange={(event) => {
            setPhone(event.target.value);
          }}
        />
        <Input
          aria-label="NIT"
          placeholder="NIT (opcional)"
          value={taxId}
          onChange={(event) => {
            setTaxId(event.target.value);
          }}
        />
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? <Spinner /> : <Plus aria-hidden="true" />} Agregar
        </Button>
      </form>
      {suppliers.isPending ? (
        <Skeleton className="h-32" />
      ) : suppliers.isError ? (
        <Alert tone="danger">{errorMessage(suppliers.error)}</Alert>
      ) : suppliers.data.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Todavía no hay proveedores"
          description="Agrega los proveedores para registrar compras y armar el pedido sugerido."
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {suppliers.data.map((supplier: Supplier) => (
              <li
                key={supplier.id}
                className={cn(
                  'flex items-center gap-3 px-4 py-3',
                  !supplier.isActive && 'opacity-60',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{supplier.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {[supplier.phone, supplier.taxId === '' ? '' : `NIT ${supplier.taxId}`]
                      .filter(Boolean)
                      .join(' · ') || 'Sin teléfono'}
                  </p>
                </div>
                <Switch
                  checked={supplier.isActive}
                  label={`${supplier.name} activo`}
                  disabled={update.isPending}
                  onCheckedChange={(isActive) => {
                    update.mutate({ id: supplier.id, isActive });
                  }}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── Pedido sugerido ────────────────────────────────────────────────

/** Texto del pedido para enviar por WhatsApp o copiar. */
function orderText(group: OrderSuggestion): string {
  const lines = group.items.map((item) => `• ${String(item.suggested)} × ${item.name}`);
  return [
    `Hola${group.supplier === null ? '' : ` ${group.supplier.name}`}, para Panes & Pan:`,
    ...lines,
  ].join('\n');
}

/** Número de WhatsApp en formato internacional (Colombia por defecto). */
function whatsappNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `57${digits}`;
  return digits.length >= 11 ? digits : null;
}

function SuggestionsTab() {
  const suggestions = useQuery({
    queryKey: purchaseKeys.suggestions,
    queryFn: ({ signal }) => getOrderSuggestions(signal),
  });

  if (suggestions.isPending) return <Skeleton className="h-40" />;
  if (suggestions.isError) {
    return (
      <ErrorState
        description={errorMessage(suggestions.error)}
        onRetry={() => void suggestions.refetch()}
      />
    );
  }
  if (suggestions.data.length === 0) {
    return (
      <EmptyState
        icon={Truck}
        title="No hay nada por pedir"
        description="Aquí aparecen los productos que llegan a su stock mínimo (se define en Inventario), agrupados por su proveedor principal (se elige en el producto)."
      />
    );
  }
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Productos en su stock mínimo o por debajo. Se sugiere pedir hasta el doble del mínimo.
      </p>
      {suggestions.data.map((group) => {
        const estimate = group.items.reduce(
          (sum, item) => sum + item.suggested * (item.cost ?? 0),
          0,
        );
        const phone = group.supplier === null ? null : whatsappNumber(group.supplier.phone);
        const text = orderText(group);
        return (
          <Card key={group.supplier?.id ?? 'sin-proveedor'} className="grid gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-extrabold">
                {group.supplier?.name ?? 'Sin proveedor principal'}
              </h2>
              {estimate > 0 ? (
                <span className="text-sm text-muted-foreground">
                  Costo estimado {formatCOP(estimate)}
                </span>
              ) : null}
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(text)
                      .then(() => toast.success('Pedido copiado'))
                      .catch(() => toast.error('No se pudo copiar'));
                  }}
                >
                  <ClipboardCopy aria-hidden="true" /> Copiar
                </Button>
                {phone === null ? null : (
                  <Button size="sm" asChild>
                    <a
                      href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MessageCircle aria-hidden="true" /> WhatsApp
                    </a>
                  </Button>
                )}
              </div>
            </div>
            <ul className="divide-y divide-border text-sm">
              {group.items.map((item) => (
                <li key={item.productId} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 font-bold">{item.name}</span>
                  <span className="text-muted-foreground">
                    Hay {item.quantity} · mín. {item.minStock}
                  </span>
                  <Badge tone="accent">Pedir {item.suggested}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
