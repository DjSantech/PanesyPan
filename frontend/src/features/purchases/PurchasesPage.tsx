import {
  formatCOP,
  PURCHASE_PAYMENT_LABELS,
  SUPPLIER_REFUND_LABELS,
  toBusinessDate,
  type OrderSuggestion,
  type Purchase,
} from '@panesypan/shared';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCopy, MessageCircle, PackageMinus, Plus, Truck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { useCan } from '../auth/use-session';
import { NewPurchaseDialog } from './NewPurchaseDialog';
import { NewSupplierReturnDialog } from './NewSupplierReturnDialog';
import { PurchaseDetailDialog } from './PurchaseDetailDialog';
import {
  getOrderSuggestions,
  listPurchases,
  listSupplierReturns,
  purchaseKeys,
  useSuppliers,
} from './purchases.api';

type Tab = 'purchases' | 'returns' | 'suggestions';

export function PurchasesPage() {
  const canManage = useCan('suppliers:manage');
  const [tab, setTab] = useState<Tab>('purchases');
  const tabs: { value: Tab; label: string }[] = canManage
    ? [
        { value: 'purchases', label: 'Compras' },
        { value: 'returns', label: 'Devoluciones' },
        { value: 'suggestions', label: 'Pedido sugerido' },
      ]
    : [
        { value: 'purchases', label: 'Compras' },
        { value: 'returns', label: 'Devoluciones' },
      ];

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
      {tab === 'returns' ? <ReturnsTab /> : null}
      {tab === 'suggestions' ? <SuggestionsTab /> : null}
    </div>
  );
}

// ── Compras ────────────────────────────────────────────────────────

const monthStart = (): string => `${toBusinessDate().slice(0, 8)}01`;
/** AAAA-MM-DD → DD/MM/AAAA. */
const shortDate = (date: string): string => date.split('-').reverse().join('/');

/** Fechas y proveedor para filtrar compras o devoluciones. */
function useRangeFilters() {
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(() => toBusinessDate());
  const [supplierId, setSupplierId] = useState('');
  const validRange = from !== '' && to !== '' && from <= to;
  const query = { from, to, ...(supplierId === '' ? {} : { supplierId }) };
  return { from, setFrom, to, setTo, supplierId, setSupplierId, validRange, query };
}

function RangeFilters({
  idPrefix,
  filters,
}: {
  idPrefix: string;
  filters: ReturnType<typeof useRangeFilters>;
}) {
  const suppliers = useSuppliers();
  return (
    <>
      <Field id={`${idPrefix}-from`} label="Desde">
        <Input
          id={`${idPrefix}-from`}
          type="date"
          value={filters.from}
          onChange={(event) => {
            filters.setFrom(event.target.value);
          }}
        />
      </Field>
      <Field id={`${idPrefix}-to`} label="Hasta">
        <Input
          id={`${idPrefix}-to`}
          type="date"
          value={filters.to}
          onChange={(event) => {
            filters.setTo(event.target.value);
          }}
        />
      </Field>
      <Field id={`${idPrefix}-supplier`} label="Proveedor">
        <NativeSelect
          id={`${idPrefix}-supplier`}
          value={filters.supplierId}
          onChange={(event) => {
            filters.setSupplierId(event.target.value);
          }}
        >
          <option value="">Todos</option>
          {(suppliers.data ?? []).map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
    </>
  );
}

function PurchasesTab() {
  const filters = useRangeFilters();
  const { validRange, query } = filters;
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Purchase | null>(null);
  const purchases = useQuery({
    queryKey: purchaseKeys.list(query),
    queryFn: ({ signal }) => listPurchases(query, signal),
    enabled: validRange,
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <RangeFilters idPrefix="purchases" filters={filters} />
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
            {purchases.data.items.length} compras · vigentes{' '}
            <strong className="tabular-nums">{formatCOP(purchases.data.total)}</strong>
          </p>
          <ul className="grid gap-2">
            {purchases.data.items.map((purchase) => (
              <li key={purchase.id}>
                <Card
                  role="button"
                  tabIndex={0}
                  aria-label={`Ver la compra N.º ${String(purchase.number)}`}
                  className={cn(
                    'grid cursor-pointer gap-1 p-4 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                    purchase.status === 'VOIDED' && 'opacity-70',
                  )}
                  onClick={() => {
                    setSelected(purchase);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelected(purchase);
                    }
                  }}
                >
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-extrabold">
                      N.º {purchase.number} · {purchase.supplier.name}
                    </span>
                    <Badge>{PURCHASE_PAYMENT_LABELS[purchase.paymentMethod]}</Badge>
                    {purchase.status === 'VOIDED' ? <Badge tone="danger">Anulada</Badge> : null}
                    <span
                      className={cn(
                        'ml-auto text-lg font-extrabold tabular-nums',
                        purchase.status === 'VOIDED' && 'line-through',
                      )}
                    >
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
      <PurchaseDetailDialog
        purchase={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

// ── Devoluciones a proveedor ───────────────────────────────────────

function ReturnsTab() {
  const filters = useRangeFilters();
  const { validRange, query } = filters;
  const [creating, setCreating] = useState(false);
  const returns = useQuery({
    queryKey: purchaseKeys.returns(query),
    queryFn: ({ signal }) => listSupplierReturns(query, signal),
    enabled: validRange,
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <RangeFilters idPrefix="returns" filters={filters} />
        <Button
          className="ml-auto"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus aria-hidden="true" /> Nueva devolución
        </Button>
      </div>

      {!validRange ? (
        <Alert tone="danger">La fecha inicial no puede ser posterior a la final.</Alert>
      ) : returns.isPending ? (
        <Skeleton className="h-40" />
      ) : returns.isError ? (
        <ErrorState
          description={errorMessage(returns.error)}
          onRetry={() => void returns.refetch()}
        />
      ) : returns.data.items.length === 0 ? (
        <EmptyState
          icon={PackageMinus}
          title="No hay devoluciones en estas fechas"
          description="Registra la mercancía que le devuelves a un proveedor con Nueva devolución."
        />
      ) : (
        <>
          <p className="text-sm">
            {returns.data.items.length} devoluciones ·{' '}
            <strong className="tabular-nums">{formatCOP(returns.data.total)}</strong>
          </p>
          <ul className="grid gap-2">
            {returns.data.items.map((entry) => (
              <li key={entry.id}>
                <Card className="grid gap-1 p-4">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-extrabold">
                      N.º {entry.number} · {entry.supplier.name}
                    </span>
                    <Badge>{SUPPLIER_REFUND_LABELS[entry.refundMethod]}</Badge>
                    <span className="ml-auto text-lg font-extrabold tabular-nums">
                      {formatCOP(entry.total)}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {shortDate(entry.businessDate)} · registró {entry.createdBy}
                  </p>
                  <p className="text-sm">
                    {entry.lines
                      .map(
                        (line) =>
                          `${String(line.quantity)} × ${line.name} (${formatCOP(line.unitCost)})`,
                      )
                      .join(' · ')}
                  </p>
                  {entry.note === '' ? null : (
                    <p className="text-sm text-muted-foreground">{entry.note}</p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      <NewSupplierReturnDialog open={creating} onOpenChange={setCreating} />
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
