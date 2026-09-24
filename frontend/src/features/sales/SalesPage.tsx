import {
  formatCOP,
  formatLongDateCO,
  formatTimeCO,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  SALE_LIMITS,
  SALE_STATUS_LABELS,
  toBusinessDate,
  type BusinessSettings,
  type CashShift,
  type PaymentMethod,
  type Sale,
} from '@panesypan/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, ReceiptText, Undo2 } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { Alert, Badge, Card, CardContent, Skeleton } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { useCan } from '../auth/use-session';
import { catalogKeys } from '../catalog/catalog.api';
import { ApprovalDialog } from '../pos/ApprovalDialog';
import { getCurrentShift, listSales, posKeys, voidSale } from '../pos/pos.api';
import { printReceipt } from '../pos/print-receipt';
import { formatSaleNumber } from '../pos/receipt-format';
import { useApprovedAction } from '../pos/use-approved-action';
import { useSettings } from '../settings/settings.api';

interface DaySummary {
  count: number;
  total: number;
  discounts: number;
  voided: number;
  byMethod: { method: PaymentMethod; amount: number; count: number }[];
}

function summarize(sales: readonly Sale[]): DaySummary {
  const paid = sales.filter((sale) => sale.status === 'PAID');
  return {
    count: paid.length,
    total: paid.reduce((sum, sale) => sum + sale.total, 0),
    discounts: paid.reduce((sum, sale) => sum + (sale.discount?.amount ?? 0), 0),
    voided: sales.filter((sale) => sale.status === 'VOIDED').length,
    byMethod: PAYMENT_METHODS.flatMap((method) => {
      const payments = paid
        .flatMap((sale) => sale.payments)
        .filter((item) => item.method === method);
      return payments.length === 0
        ? []
        : [
            {
              method,
              amount: payments.reduce((sum, item) => sum + item.amount, 0),
              count: payments.length,
            },
          ];
    }),
  };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid content-start gap-0.5 rounded-2xl bg-muted p-3">
      <span className="text-xs font-bold text-muted-foreground">{label}</span>
      <span className="text-xl font-extrabold">{value}</span>
      {hint === undefined ? null : <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function SummaryCard({
  summary,
  shift,
}: {
  summary: DaySummary;
  shift: CashShift | null | undefined;
}) {
  const current = shift ?? null;
  return (
    <Card className="mb-5">
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {current === null ? null : (
            <Stat label="Base inicial" value={formatCOP(current.openingAmount)} />
          )}
          <Stat
            label="Ventas"
            value={formatCOP(summary.total)}
            hint={`${String(summary.count)} cobradas`}
          />
          {current === null ? (
            <Stat label="Descuentos" value={formatCOP(summary.discounts)} />
          ) : (
            <Stat
              label="Efectivo esperado"
              value={formatCOP(current.summary.expectedCash)}
              hint="Base + ventas en efectivo"
            />
          )}
          <Stat label="Anuladas" value={String(summary.voided)} />
        </div>
        {summary.byMethod.length === 0 ? null : (
          <ul className="flex flex-wrap gap-2" aria-label="Por medio de pago">
            {summary.byMethod.map((item) => (
              <li key={item.method}>
                <Badge tone="accent" className="px-3 py-1 text-sm">
                  {PAYMENT_METHOD_LABELS[item.method]}: {formatCOP(item.amount)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_TONE = {
  OPEN: 'pending',
  PAID: 'success',
  VOIDED: 'danger',
  CANCELED: 'neutral',
} as const;

function SaleRow({ sale, onOpen }: { sale: Sale; onOpen: () => void }) {
  const time = new Date(sale.paidAt ?? sale.closure?.at ?? sale.openedAt);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
      >
        <span className="w-20 font-extrabold tabular-nums">
          {sale.number === null ? 'Mesa' : `#${formatSaleNumber(sale.number)}`}
        </span>
        <span className="w-20 text-sm text-muted-foreground">{formatTimeCO(time)}</span>
        <span className="min-w-0 flex-1 truncate text-sm">
          {sale.tableNumber === null ? 'Mostrador' : `Mesa ${String(sale.tableNumber)}`} ·{' '}
          {sale.payments.map((payment) => PAYMENT_METHOD_LABELS[payment.method]).join(' + ') || '—'}
          {sale.paidBy === null ? '' : ` · ${sale.paidBy.name}`}
        </span>
        <Badge tone={STATUS_TONE[sale.status]}>{SALE_STATUS_LABELS[sale.status]}</Badge>
        <span
          className={cn(
            'w-24 text-right font-extrabold tabular-nums',
            sale.status !== 'PAID' && 'text-muted-foreground line-through',
          )}
        >
          {formatCOP(sale.total)}
        </span>
      </button>
    </li>
  );
}

function SaleDetailDialog({
  sale,
  settings,
  onOpenChange,
  onVoided,
}: {
  sale: Sale | null;
  settings: BusinessSettings | undefined;
  onOpenChange: (open: boolean) => void;
  onVoided: (sale: Sale) => void;
}) {
  const [voiding, setVoiding] = useState(false);
  return (
    <Dialog
      open={sale !== null}
      onOpenChange={(open) => {
        setVoiding(false);
        onOpenChange(open);
      }}
    >
      {sale === null ? null : (
        <DialogContent
          title={
            sale.number === null ? 'Cuenta de mesa' : `Venta N.º ${formatSaleNumber(sale.number)}`
          }
          description={`${SALE_STATUS_LABELS[sale.status]} · ${formatLongDateCO(new Date(sale.paidAt ?? sale.openedAt))}`}
          className="sm:max-w-lg"
        >
          {voiding ? (
            <VoidForm
              sale={sale}
              onBack={() => {
                setVoiding(false);
              }}
              onVoided={(voided) => {
                setVoiding(false);
                onVoided(voided);
              }}
            />
          ) : (
            <div className="grid gap-4">
              <ul className="grid gap-2 text-sm">
                {sale.lines.map((line) => (
                  <li key={line.id} className="flex justify-between gap-3">
                    <span>
                      {line.quantity} × {line.name}
                      {line.note === '' ? null : (
                        <span className="block text-muted-foreground">{line.note}</span>
                      )}
                    </span>
                    <span className="font-bold">{formatCOP(line.total)}</span>
                  </li>
                ))}
              </ul>
              <div className="grid gap-1 border-t border-border pt-3 text-sm">
                {sale.discount === null ? null : (
                  <p className="flex justify-between">
                    <span>
                      Descuento ({sale.discount.reason})
                      {sale.discount.approvedBy === null
                        ? ''
                        : ` · autorizó ${sale.discount.approvedBy.name}`}
                    </span>
                    <span>−{formatCOP(sale.discount.amount)}</span>
                  </p>
                )}
                <p className="flex justify-between text-lg font-extrabold">
                  <span>Total</span>
                  <span>{formatCOP(sale.total)}</span>
                </p>
                {sale.payments.map((payment) => (
                  <p key={payment.method} className="flex justify-between text-muted-foreground">
                    <span>
                      {PAYMENT_METHOD_LABELS[payment.method]}
                      {payment.reference === '' ? '' : ` (${payment.reference})`}
                    </span>
                    <span>{formatCOP(payment.amount)}</span>
                  </p>
                ))}
                {sale.cashReceived === null ? null : (
                  <p className="flex justify-between text-muted-foreground">
                    <span>Recibido / cambio</span>
                    <span>
                      {formatCOP(sale.cashReceived)} / {formatCOP(sale.change)}
                    </span>
                  </p>
                )}
              </div>
              {sale.closure === null ? null : (
                <Alert tone={sale.status === 'VOIDED' ? 'danger' : 'info'}>
                  <span>
                    {sale.status === 'VOIDED' ? 'Anulada' : 'Cancelada'} por {sale.closure.by.name}
                    {sale.closure.approvedBy === null ||
                    sale.closure.approvedBy.id === sale.closure.by.id
                      ? ''
                      : `, autorizó ${sale.closure.approvedBy.name}`}
                    : “{sale.closure.reason}”
                  </span>
                </Alert>
              )}
              <DialogFooter className="mt-0">
                {sale.status === 'PAID' ? (
                  <Button
                    variant="outline"
                    className="text-danger"
                    onClick={() => {
                      setVoiding(true);
                    }}
                  >
                    <Undo2 aria-hidden="true" /> Anular venta
                  </Button>
                ) : null}
                {sale.number === null ? null : (
                  <Button
                    disabled={settings === undefined}
                    onClick={() => {
                      if (settings !== undefined) printReceipt(sale, settings);
                    }}
                  >
                    <Printer aria-hidden="true" /> Reimprimir tiquete
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

function VoidForm({
  sale,
  onBack,
  onVoided,
}: {
  sale: Sale;
  onBack: () => void;
  onVoided: (sale: Sale) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const action = useApprovedAction<Sale>({
    run: (pin) =>
      voidSale(sale.id, {
        reason: reason.trim(),
        ...(pin === undefined ? {} : { approverPin: pin }),
      }),
    onSuccess: onVoided,
    onError: (failure) => {
      setError(errorMessage(failure));
    },
  });
  const valid = reason.trim().length >= SALE_LIMITS.reasonMin;

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid) return;
    setError(null);
    action.execute();
  };

  return (
    <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
      <Alert tone="pending">
        Se anula {formatCOP(sale.total)}: deja de contar en la caja y, si hay almuerzos, se
        devuelven las porciones. Quedará en la auditoría.
      </Alert>
      <Field id="void-reason" label="Motivo de la anulación">
        <Input
          id="void-reason"
          autoFocus
          maxLength={SALE_LIMITS.reasonMax}
          placeholder="Ej.: se cobró dos veces"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </Field>
      {error === null ? null : <Alert tone="danger">{error}</Alert>}
      <DialogFooter className="mt-0">
        <Button variant="outline" onClick={onBack} disabled={action.pending}>
          Volver
        </Button>
        <Button type="submit" variant="destructive" disabled={!valid || action.pending}>
          {action.pending ? <Spinner /> : null} Anular venta
        </Button>
      </DialogFooter>
      <ApprovalDialog
        {...action.approvalProps}
        description={`Anular la venta N.º ${formatSaleNumber(sale.number)}: pide a un administrador que digite su PIN.`}
      />
    </form>
  );
}

/**
 * Ventas: la cajera ve las de su caja abierta; el administrador, las de cualquier día.
 */
export function SalesPage() {
  const queryClient = useQueryClient();
  const seesAll = useCan('reports:read');
  const settings = useSettings();
  const [date, setDate] = useState(() => toBusinessDate());
  const [selected, setSelected] = useState<Sale | null>(null);

  const shift = useQuery({
    queryKey: posKeys.shift,
    queryFn: ({ signal }) => getCurrentShift(signal),
    enabled: !seesAll,
  });
  const query = seesAll ? { date } : {};
  const sales = useQuery({
    queryKey: posKeys.sales(query),
    queryFn: ({ signal }) => listSales(query, signal),
  });

  const items = sales.data ?? [];
  const summary = summarize(items);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Ventas"
        description={
          seesAll
            ? formatLongDateCO(new Date(`${date}T12:00:00-05:00`))
            : 'Las ventas de tu caja abierta.'
        }
        actions={
          seesAll ? (
            <Field id="sales-date" label="Día" className="w-44">
              <Input
                id="sales-date"
                type="date"
                value={date}
                max={toBusinessDate()}
                onChange={(event) => {
                  if (event.target.value !== '') setDate(event.target.value);
                }}
              />
            </Field>
          ) : undefined
        }
      />

      {sales.isPending || (!seesAll && shift.isPending) ? (
        <div className="grid gap-3" aria-busy="true" aria-label="Cargando ventas">
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      ) : sales.isError ? (
        <ErrorState description={errorMessage(sales.error)} onRetry={() => void sales.refetch()} />
      ) : !seesAll && shift.data === null ? (
        <EmptyState
          icon={ReceiptText}
          title="No tienes la caja abierta"
          description="Abre la caja en Vender para empezar a registrar ventas."
        />
      ) : (
        <>
          <SummaryCard summary={summary} shift={shift.data} />
          {items.length === 0 ? (
            <EmptyState icon={ReceiptText} title="Todavía no hay ventas" />
          ) : (
            <Card>
              <ul className="divide-y divide-border" aria-label="Lista de ventas">
                {items.map((sale) => (
                  <SaleRow
                    key={sale.id}
                    sale={sale}
                    onOpen={() => {
                      setSelected(sale);
                    }}
                  />
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <SaleDetailDialog
        sale={selected}
        settings={settings.data}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onVoided={(voided) => {
          setSelected(voided);
          toast.success(`Venta N.º ${formatSaleNumber(voided.number)} anulada`);
          void queryClient.invalidateQueries({ queryKey: posKeys.all });
          void queryClient.invalidateQueries({ queryKey: catalogKeys.dailyMenu(toBusinessDate()) });
        }}
      />
    </div>
  );
}
