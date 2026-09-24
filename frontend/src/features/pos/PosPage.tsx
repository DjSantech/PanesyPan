import {
  formatCOP,
  formatLongDateCO,
  formatTimeCO,
  toBusinessDate,
  type CashShift,
  type Sale,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRightLeft, Ban, ShoppingBasket, Wallet } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ErrorState, Spinner } from '@/components/feedback';
import { PriceInput } from '@/components/PriceInput';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Alert, Card, CardContent, Skeleton } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { cn, firstName } from '@/lib/utils';
import { useCan, useCurrentUser } from '../auth/use-session';
import { catalogKeys } from '../catalog/catalog.api';
import { useSettings } from '../settings/settings.api';
import { useCartStore } from './cart.store';
import { CheckoutDialog, type CheckoutPayload } from './CheckoutDialog';
import { LunchDialog } from './LunchDialog';
import { OrderPanel, type OrderLineView } from './OrderPanel';
import {
  addTabLine,
  cancelTab,
  checkoutCounter,
  checkoutTab,
  getCurrentShift,
  listOpenTabs,
  moveTab,
  openShift,
  openTab,
  posKeys,
  removeTabLine,
  updateTabLine,
} from './pos.api';
import { ProductPicker } from './ProductPicker';
import { SaleDoneDialog } from './SaleDoneDialog';
import { CancelTabDialog, MoveTabDialog } from './TabDialogs';
import { TablesGrid } from './TablesGrid';
import { usePosCatalog, type PosProduct } from './use-pos-catalog';

type Mode = 'counter' | 'tables';

/** Punto de venta: si la cajera no tiene la caja abierta, primero la abre. */
export function PosPage() {
  const shift = useQuery({
    queryKey: posKeys.shift,
    queryFn: ({ signal }) => getCurrentShift(signal),
  });

  if (shift.isPending) {
    return (
      <div className="grid gap-4 md:grid-cols-[1fr_22rem]" aria-busy="true" aria-label="Cargando">
        <Skeleton className="h-96" />
        <Skeleton className="hidden h-96 md:block" />
      </div>
    );
  }
  if (shift.isError) {
    return (
      <ErrorState description={errorMessage(shift.error)} onRetry={() => void shift.refetch()} />
    );
  }
  return shift.data === null ? <OpenShiftPanel /> : <PosWorkspace shift={shift.data} />;
}

// ── Apertura de caja ───────────────────────────────────────────────

function OpenShiftPanel() {
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const open = useMutation({
    mutationFn: openShift,
    onSuccess: (shift) => {
      queryClient.setQueryData(posKeys.shift, shift);
      toast.success('Caja abierta. ¡Buen turno!');
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (amount === null) {
      setFieldError('Escribe la base (0 si empiezas sin efectivo)');
      return;
    }
    setFieldError(null);
    open.mutate({ openingAmount: amount, note });
  };

  return (
    <div className="mx-auto grid max-w-md gap-4 py-4">
      <Card>
        <CardContent className="grid gap-5">
          <div className="grid justify-items-center gap-2 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent-soft-foreground">
              <Wallet className="size-7" aria-hidden="true" />
            </span>
            <h1 className="font-display text-2xl font-bold">Abrir caja</h1>
            <p className="text-sm text-muted-foreground">
              {firstName(user.name)}, cuenta el efectivo con el que empiezas el turno (la base).
              Todas tus ventas quedarán en esta caja.
            </p>
          </div>
          <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
            <Field id="opening-amount" label="Base inicial en efectivo" error={fieldError}>
              <PriceInput
                id="opening-amount"
                autoFocus
                className="h-14 text-2xl"
                value={amount}
                onValueChange={setAmount}
                aria-invalid={fieldError === null ? undefined : true}
              />
            </Field>
            <Field id="opening-note" label="Nota (opcional)">
              <Input
                id="opening-note"
                maxLength={200}
                placeholder="Ej.: faltan monedas de 500"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            </Field>
            {open.isError ? <Alert tone="danger">{errorMessage(open.error)}</Alert> : null}
            <Button type="submit" size="lg" disabled={open.isPending}>
              {open.isPending ? <Spinner /> : <Wallet aria-hidden="true" />} Abrir caja
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Punto de venta ─────────────────────────────────────────────────

function upsertTab(tabs: Sale[] | undefined, sale: Sale): Sale[] {
  const others = (tabs ?? []).filter((tab) => tab.id !== sale.id);
  if (sale.status !== 'OPEN') return others;
  return [...others, sale].sort((a, b) => (a.tableNumber ?? 0) - (b.tableNumber ?? 0));
}

function PosWorkspace({ shift }: { shift: CashShift }) {
  const queryClient = useQueryClient();
  const canApprove = useCan('sales:void:approve');
  const settings = useSettings();
  const catalog = usePosCatalog();
  const tabs = useQuery({
    queryKey: posKeys.tabs,
    queryFn: ({ signal }) => listOpenTabs(signal),
    // Otras cajeras también atienden las mesas.
    refetchInterval: 15_000,
  });
  const cartLines = useCartStore((state) => state.lines);
  const addToCart = useCartStore((state) => state.add);
  const setCartQuantity = useCartStore((state) => state.setQuantity);
  const clearCart = useCartStore((state) => state.clear);

  const [mode, setMode] = useState<Mode>('counter');
  const [tabId, setTabId] = useState<string | null>(null);
  const [lunchFor, setLunchFor] = useState<PosProduct | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [doneSale, setDoneSale] = useState<Sale | null>(null);
  const [orderSheet, setOrderSheet] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [openingTable, setOpeningTable] = useState<number | null>(null);

  // Si otra cajera cobró o canceló la mesa, deja de estar seleccionada.
  const selectedTab =
    mode === 'tables' ? (tabs.data?.find((tab) => tab.id === tabId) ?? null) : null;

  const refreshAfterSale = () => {
    void queryClient.invalidateQueries({ queryKey: posKeys.shift });
    void queryClient.invalidateQueries({ queryKey: ['pos', 'sales'] });
    void queryClient.invalidateQueries({ queryKey: catalogKeys.dailyMenu(toBusinessDate()) });
  };

  const tabAction = useMutation({
    mutationFn: (run: () => Promise<Sale>) => run(),
    onSuccess: (sale) => {
      queryClient.setQueryData<Sale[]>(posKeys.tabs, (current) => upsertTab(current, sale));
      void queryClient.invalidateQueries({ queryKey: catalogKeys.dailyMenu(toBusinessDate()) });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      void tabs.refetch();
      catalog.refetch();
    },
  });

  const addProduct = (product: PosProduct, note: string) => {
    if (selectedTab !== null) {
      tabAction.mutate(() =>
        addTabLine(selectedTab.id, { productId: product.id, quantity: 1, note }),
      );
    } else {
      addToCart(product.id, note);
    }
  };

  const pickProduct = (product: PosProduct) => {
    if (product.isLunch && (catalog.menu?.proteins.length ?? 0) > 0) {
      setLunchFor(product);
      return;
    }
    addProduct(product, '');
  };

  const selectTable = (tableNumber: number, tab: Sale | undefined) => {
    if (tab !== undefined) {
      setTabId(tab.id);
      return;
    }
    setOpeningTable(tableNumber);
    tabAction.mutate(() => openTab(tableNumber), {
      onSuccess: (sale) => {
        setTabId(sale.id);
      },
      onSettled: () => {
        setOpeningTable(null);
      },
    });
  };

  // ── Líneas del pedido que se muestra a la derecha ──
  const productById = new Map(
    (catalog.data?.products ?? []).map((product) => [product.id, product]),
  );
  const counterLines: OrderLineView[] = cartLines.map((line) => {
    const product = productById.get(line.productId);
    const unitPrice = product?.price ?? 0;
    return {
      key: line.key,
      name: product?.name ?? 'Producto retirado',
      note: line.note,
      unitPrice,
      quantity: line.quantity,
      total: unitPrice * line.quantity,
      unavailable: product?.isAvailable !== true,
    };
  });
  const tabLines: OrderLineView[] = (selectedTab?.lines ?? []).map((line) => ({
    key: line.id,
    name: line.name,
    note: line.note,
    unitPrice: line.unitPrice,
    quantity: line.quantity,
    total: line.total,
  }));

  const isCounter = mode === 'counter';
  const lines = isCounter ? counterLines : tabLines;
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  const blocked = isCounter && counterLines.some((line) => line.unavailable === true);
  const openTabs = tabs.data ?? [];

  const changeQuantity = (key: string, quantity: number) => {
    if (isCounter) {
      setCartQuantity(key, quantity);
      return;
    }
    if (selectedTab === null) return;
    tabAction.mutate(() =>
      quantity <= 0
        ? removeTabLine(selectedTab.id, key)
        : updateTabLine(selectedTab.id, key, quantity),
    );
  };

  const submitCheckout = (payload: CheckoutPayload): Promise<Sale> =>
    selectedTab === null
      ? checkoutCounter({
          ...payload,
          lines: cartLines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            note: line.note,
          })),
        })
      : checkoutTab(selectedTab.id, payload);

  const handlePaid = (sale: Sale) => {
    setCheckoutOpen(false);
    setOrderSheet(false);
    setDoneSale(sale);
    if (sale.type === 'COUNTER') {
      clearCart();
    } else {
      queryClient.setQueryData<Sale[]>(posKeys.tabs, (current) => upsertTab(current, sale));
      setTabId(null);
    }
    refreshAfterSale();
  };

  const orderTitle = isCounter
    ? 'Pedido de mostrador'
    : selectedTab === null
      ? 'Mesas'
      : `Mesa ${String(selectedTab.tableNumber ?? '')}`;
  const orderSubtitle =
    selectedTab === null
      ? undefined
      : `Abierta a las ${formatTimeCO(new Date(selectedTab.openedAt))} por ${firstName(selectedTab.openedBy.name)}`;

  const renderOrder = (hideHeader: boolean, className?: string) =>
    !isCounter && selectedTab === null ? (
      <div
        className={cn(
          'grid place-items-center rounded-2xl border border-dashed border-border p-8 text-center text-sm font-semibold text-muted-foreground',
          className,
        )}
      >
        Elige una mesa para ver su cuenta.
      </div>
    ) : (
      <OrderPanel
        className={className}
        title={orderTitle}
        subtitle={orderSubtitle}
        hideHeader={hideHeader}
        lines={lines}
        total={total}
        busy={tabAction.isPending}
        emptyText={
          isCounter
            ? 'Toca los productos para armar el pedido.'
            : 'La mesa no tiene productos todavía.'
        }
        onChangeQuantity={changeQuantity}
      >
        {selectedTab === null ? null : (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setMoveOpen(true);
              }}
            >
              <ArrowRightLeft aria-hidden="true" /> Cambiar mesa
            </Button>
            <Button
              variant="outline"
              className="text-danger"
              onClick={() => {
                setCancelOpen(true);
              }}
            >
              <Ban aria-hidden="true" /> Cancelar
            </Button>
          </div>
        )}
        {isCounter && lines.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearCart}>
            Vaciar pedido
          </Button>
        ) : null}
        <Button
          size="lg"
          className="h-14 text-lg"
          disabled={lines.length === 0 || blocked || tabAction.isPending}
          onClick={() => {
            setCheckoutOpen(true);
          }}
        >
          Cobrar {formatCOP(total)}
        </Button>
      </OrderPanel>
    );

  const staleShift = shift.businessDate !== toBusinessDate();
  const loading = catalog.isPending || settings.isPending;

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_22rem] lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="grid min-w-0 content-start gap-4 pb-24 md:pb-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex rounded-xl bg-muted p-1"
            role="radiogroup"
            aria-label="Tipo de venta"
          >
            {(
              [
                ['counter', 'Mostrador'],
                ['tables', `Mesas${openTabs.length > 0 ? ` (${String(openTabs.length)})` : ''}`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => {
                  setMode(value);
                  setTabId(null);
                }}
                className={cn(
                  'h-11 rounded-lg px-5 text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  mode === value ? 'bg-card shadow-xs' : 'text-muted-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Link
            to="/ventas"
            className="text-sm font-bold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Caja abierta desde las {formatTimeCO(new Date(shift.openedAt))} · Ver ventas
          </Link>
        </div>

        {staleShift ? (
          <Alert tone="pending">
            Esta caja se abrió el {formatLongDateCO(new Date(shift.openedAt)).toLowerCase()}. El
            cierre de caja llega en la próxima etapa del sistema.
          </Alert>
        ) : null}

        {loading ? (
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            aria-busy="true"
            aria-label="Cargando productos"
          >
            {Array.from({ length: 9 }, (_, index) => (
              <Skeleton key={index} className="h-24" />
            ))}
          </div>
        ) : catalog.error !== null || catalog.data === undefined ? (
          <ErrorState description={errorMessage(catalog.error)} onRetry={catalog.refetch} />
        ) : mode === 'tables' && selectedTab === null ? (
          <TablesGrid
            tableCount={settings.data?.tableCount ?? 0}
            tabs={openTabs}
            busyTable={openingTable}
            onSelect={selectTable}
          />
        ) : (
          <>
            {selectedTab === null ? null : (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setTabId(null);
                  }}
                >
                  <ArrowLeft aria-hidden="true" /> Mesas
                </Button>
                <p className="text-lg font-extrabold">
                  Agregando a la mesa {selectedTab.tableNumber}
                </p>
              </div>
            )}
            <ProductPicker
              categories={catalog.data.categories}
              products={catalog.data.products}
              onPick={pickProduct}
            />
          </>
        )}
      </div>

      <aside className="hidden md:block" aria-label="Pedido">
        {renderOrder(false, 'sticky top-20 h-[calc(100dvh-6.5rem)]')}
      </aside>

      {/* Celular: el pedido se abre desde una barra fija encima de la navegación. */}
      {!isCounter && selectedTab === null ? null : (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-card/95 p-3 backdrop-blur md:hidden">
          <Button
            size="lg"
            className="h-14 w-full justify-between text-base"
            onClick={() => {
              setOrderSheet(true);
            }}
          >
            <span className="flex items-center gap-2">
              <ShoppingBasket aria-hidden="true" /> Ver pedido
              {lines.length > 0
                ? ` (${String(lines.reduce((sum, line) => sum + line.quantity, 0))})`
                : ''}
            </span>
            <span>{formatCOP(total)}</span>
          </Button>
        </div>
      )}
      <Dialog open={orderSheet} onOpenChange={setOrderSheet}>
        <DialogContent title={orderTitle} description={orderSubtitle} className="p-3 sm:max-w-lg">
          {renderOrder(true, 'max-h-[70dvh] border-0 shadow-none')}
        </DialogContent>
      </Dialog>

      {catalog.menu === undefined ? null : (
        <LunchDialog
          product={lunchFor}
          menu={catalog.menu}
          onOpenChange={(open) => {
            if (!open) setLunchFor(null);
          }}
          onChoose={(product, note) => {
            setLunchFor(null);
            addProduct(product, note);
          }}
        />
      )}

      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        title={
          selectedTab === null
            ? 'Cobrar pedido'
            : `Cobrar mesa ${String(selectedTab.tableNumber ?? '')}`
        }
        subtotal={total}
        maxDiscountPercent={settings.data?.maxCashierDiscountPercent ?? 0}
        canApprove={canApprove}
        submit={submitCheckout}
        onPaid={handlePaid}
        onStale={(message) => {
          toast.error(message);
          setCheckoutOpen(false);
          catalog.refetch();
          void tabs.refetch();
        }}
      />

      <SaleDoneDialog
        sale={doneSale}
        settings={settings.data}
        onClose={() => {
          setDoneSale(null);
        }}
      />

      <MoveTabDialog
        tab={moveOpen ? selectedTab : null}
        tableCount={settings.data?.tableCount ?? 0}
        busyTables={new Set(openTabs.map((tab) => tab.tableNumber ?? 0))}
        pending={tabAction.isPending}
        onOpenChange={setMoveOpen}
        onMove={(tableNumber) => {
          if (selectedTab === null) return;
          tabAction.mutate(() => moveTab(selectedTab.id, tableNumber), {
            onSuccess: () => {
              setMoveOpen(false);
              toast.success(`La cuenta pasó a la mesa ${String(tableNumber)}`);
            },
          });
        }}
      />

      <CancelTabDialog
        tab={cancelOpen ? selectedTab : null}
        onOpenChange={setCancelOpen}
        cancel={(tab, reason, pin) =>
          cancelTab(tab.id, { reason, ...(pin === undefined ? {} : { approverPin: pin }) })
        }
        onCanceled={(sale) => {
          setCancelOpen(false);
          setOrderSheet(false);
          queryClient.setQueryData<Sale[]>(posKeys.tabs, (current) => upsertTab(current, sale));
          setTabId(null);
          refreshAfterSale();
          toast.success(`Se canceló la cuenta de la mesa ${String(sale.tableNumber ?? '')}`);
        }}
        onError={(error) => {
          toast.error(errorMessage(error));
          void tabs.refetch();
        }}
      />
    </div>
  );
}
