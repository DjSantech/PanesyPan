import {
  STOCK_MOVEMENT_LABELS,
  WASTE_REASON_LABELS,
  type InventoryItem,
  type StockMovement,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  ClipboardList,
  EllipsisVertical,
  Flame,
  PackageOpen,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { useCan } from '../auth/use-session';
import {
  adjustStock,
  inventoryKeys,
  listInventory,
  listMovements,
  registerProduction,
  registerWaste,
  setMinStock,
} from './inventory.api';
import { StockDialog, type StockDialogMode, type StockDialogValues } from './StockDialog';

type Tab = 'stock' | 'production' | 'waste';

const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'stock', label: 'Stock' },
  { value: 'production', label: 'Producción de hoy' },
  { value: 'waste', label: 'Mermas de hoy' },
];

const timeFormat = new Intl.DateTimeFormat('es-CO', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Bogota',
});

function StockRow({
  item,
  tab,
  canRecord,
  canManage,
  onAction,
}: {
  item: InventoryItem;
  tab: Tab;
  canRecord: boolean;
  canManage: boolean;
  onAction: (mode: StockDialogMode) => void;
}) {
  const empty = item.quantity === 0;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-extrabold">{item.name}</span>
          {item.isLow ? (
            <Badge tone="danger">
              <BellRing className="size-3.5" aria-hidden="true" />
              {empty ? 'Sin stock' : 'Bajo stock'}
            </Badge>
          ) : null}
        </p>
        <p className="text-sm text-muted-foreground">
          {item.categoryName}
          {item.minStock > 0 ? ` · aviso en ${String(item.minStock)}` : ''}
        </p>
      </div>

      {tab === 'production' ? (
        <p className="text-right text-sm text-muted-foreground">
          <span className="block text-2xl font-extrabold text-foreground">
            {item.producedToday}
          </span>
          hoy
        </p>
      ) : tab === 'waste' ? (
        <p className="text-right text-sm text-muted-foreground">
          <span className="block text-2xl font-extrabold text-foreground">{item.wastedToday}</span>
          hoy
        </p>
      ) : (
        <p
          className={cn(
            'min-w-14 text-right text-3xl font-extrabold',
            item.isLow ? 'text-danger' : 'text-primary',
          )}
          aria-label={`${String(item.quantity)} unidades`}
        >
          {item.quantity}
        </p>
      )}

      {tab === 'production' && canRecord ? (
        <Button
          size="sm"
          onClick={() => {
            onAction('production');
          }}
        >
          <Flame aria-hidden="true" /> Producir
        </Button>
      ) : null}
      {tab === 'waste' && canRecord ? (
        <Button
          size="sm"
          variant="outline"
          disabled={empty}
          onClick={() => {
            onAction('waste');
          }}
        >
          <Trash2 aria-hidden="true" /> Merma
        </Button>
      ) : null}
      {tab === 'stock' && canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Acciones para ${item.name}`}>
              <EllipsisVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onSelect={() => {
                onAction('adjust');
              }}
            >
              <ClipboardList aria-hidden="true" /> Ajustar por conteo
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onAction('min');
              }}
            >
              <BellRing aria-hidden="true" /> Stock mínimo
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

function MovementsCard({ type }: { type: 'PRODUCTION' | 'WASTE' }) {
  const query = { type } as const;
  const movements = useQuery({
    queryKey: inventoryKeys.movements(query),
    queryFn: ({ signal }) => listMovements(query, signal),
  });
  const rows: StockMovement[] = movements.data ?? [];
  return (
    <section aria-labelledby={`movements-${type}`} className="mt-6">
      <h2
        id={`movements-${type}`}
        className="mb-2 text-sm font-extrabold tracking-wide text-muted-foreground uppercase"
      >
        {type === 'PRODUCTION' ? 'Producción registrada hoy' : 'Mermas registradas hoy'}
      </h2>
      <Card>
        {movements.isPending ? (
          <Skeleton className="m-4 h-5 w-48" />
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Todavía no hay registros hoy.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((movement) => (
              <li key={movement.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-16 shrink-0 font-bold text-muted-foreground">
                  {timeFormat.format(new Date(movement.createdAt))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-extrabold">{movement.productName}</span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {movement.by.name}
                    {movement.reason === null ? '' : ` · ${WASTE_REASON_LABELS[movement.reason]}`}
                    {movement.note === '' ? '' : ` · ${movement.note}`}
                  </span>
                </span>
                <span className="font-extrabold">
                  {Math.abs(movement.delta)}{' '}
                  <span className="sr-only">{STOCK_MOVEMENT_LABELS[movement.type]}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

export function InventoryPage() {
  const canRecord = useCan('inventory:record');
  const canManage = useCan('inventory:manage');
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('stock');
  const [onlyLow, setOnlyLow] = useState(false);
  const [dialog, setDialog] = useState<{ mode: StockDialogMode; item: InventoryItem } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const inventory = useQuery({
    queryKey: inventoryKeys.stock(onlyLow),
    queryFn: ({ signal }) => listInventory(onlyLow, signal),
    // El stock cambia con cada venta: se refresca solo mientras la página está abierta.
    refetchInterval: 60_000,
  });

  const save = useMutation({
    mutationFn: ({
      mode,
      item,
      values,
    }: {
      mode: StockDialogMode;
      item: InventoryItem;
      values: StockDialogValues;
    }) => {
      const { productId } = item;
      switch (mode) {
        case 'production':
          return registerProduction({ productId, quantity: values.quantity, note: values.note });
        case 'waste':
          return registerWaste({
            productId,
            quantity: values.quantity,
            reason: values.reason,
            note: values.note,
          });
        case 'adjust':
          return adjustStock({ productId, newQuantity: values.quantity, note: values.note });
        case 'min':
          return setMinStock(productId, { minStock: values.quantity });
      }
    },
    onSuccess: async (item, { mode }) => {
      setDialog(null);
      await queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
      toast.success(
        mode === 'min'
          ? `Mínimo de "${item.name}" guardado`
          : `"${item.name}": ahora hay ${String(item.quantity)}`,
      );
      if (item.isLow && mode !== 'production') {
        toast.warning(`Bajo stock: quedan ${String(item.quantity)} de "${item.name}"`);
      }
    },
    onError: (error) => {
      setDialogError(errorMessage(error));
    },
  });

  const items = inventory.data?.items ?? [];
  const lowStockCount = inventory.data?.lowStockCount ?? 0;

  return (
    <div>
      <PageHeader
        title="Inventario"
        description="Existencias de productos terminados, producción del día y mermas."
      />

      {lowStockCount > 0 ? (
        <Alert tone="danger" className="mb-4">
          <BellRing aria-hidden="true" />
          <span className="flex-1">
            <strong>
              {lowStockCount === 1
                ? '1 producto está por agotarse.'
                : `${String(lowStockCount)} productos están por agotarse.`}
            </strong>{' '}
            Revisa el stock y programa la producción.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setTab('stock');
              setOnlyLow((value) => !value);
            }}
          >
            {onlyLow ? 'Ver todos' : 'Ver cuáles'}
          </Button>
        </Alert>
      ) : null}

      <div
        role="tablist"
        aria-label="Secciones"
        className="mb-4 inline-flex rounded-xl bg-muted p-1"
      >
        {TABS.map((item) => (
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

      {inventory.isPending ? (
        <Card aria-busy="true" aria-label="Cargando inventario">
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-b border-border px-4 py-4 last:border-0"
            >
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-8 w-12" />
            </div>
          ))}
        </Card>
      ) : inventory.isError ? (
        <ErrorState
          description={errorMessage(inventory.error)}
          onRetry={() => {
            void inventory.refetch();
          }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title={onlyLow ? 'Nada por agotarse' : 'Ningún producto controla inventario'}
          description={
            onlyLow
              ? 'Todos los productos están por encima de su mínimo.'
              : 'Activa "Controlar inventario" en un producto del catálogo para verlo aquí.'
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <StockRow
                key={item.productId}
                item={item}
                tab={tab}
                canRecord={canRecord}
                canManage={canManage}
                onAction={(mode) => {
                  setDialogError(null);
                  setDialog({ mode, item });
                }}
              />
            ))}
          </ul>
        </Card>
      )}

      {tab === 'production' ? <MovementsCard type="PRODUCTION" /> : null}
      {tab === 'waste' ? <MovementsCard type="WASTE" /> : null}

      {dialog === null ? null : (
        <StockDialog
          key={`${dialog.mode}-${dialog.item.productId}`}
          mode={dialog.mode}
          item={dialog.item}
          pending={save.isPending}
          error={dialogError}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          onSubmit={(values) => {
            setDialogError(null);
            save.mutate({ mode: dialog.mode, item: dialog.item, values });
          }}
        />
      )}
    </div>
  );
}
