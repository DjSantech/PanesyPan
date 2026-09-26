import {
  formatCOP,
  formatDateTimeCO,
  nextWebOrderStatus,
  WEB_ORDER_STATUS_LABELS,
  WEB_ORDER_STATUSES,
  type WebOrder,
  type WebOrderStatus,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Phone, ShoppingBag } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, Skeleton } from '@/components/ui/surface';
import { useCan } from '@/features/auth/use-session';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { useWebOrdersRealtime } from './use-web-orders-realtime';
import { listWebOrders, updateWebOrderStatus, webOrderKeys } from './web-orders.api';
import {
  customerWhatsappUrl,
  NEXT_ACTION_LABEL,
  sortWebOrders,
  STATUS_TONE,
} from './web-orders-logic';

/** Respaldo por si el tiempo real no está disponible. */
const POLL_MS = 30_000;

function OrderCard({
  order,
  canManage,
  onAdvance,
  advancing,
}: {
  order: WebOrder;
  canManage: boolean;
  onAdvance: (status: WebOrderStatus) => void;
  advancing: boolean;
}) {
  const next = nextWebOrderStatus(order.status);
  const { customer } = order;
  return (
    <Card>
      <CardContent className="grid gap-3 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-lg font-extrabold">Pedido #{order.number}</span>
          <Badge tone={STATUS_TONE[order.status]}>{WEB_ORDER_STATUS_LABELS[order.status]}</Badge>
          <span className="text-sm text-muted-foreground">
            {formatDateTimeCO(new Date(order.createdAt))}
          </span>
          <span className="ml-auto text-lg font-extrabold tabular-nums">
            {formatCOP(order.total)}
          </span>
        </div>
        <div className="grid gap-1 text-sm">
          <p className="font-bold">{customer.name}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <a
              href={`tel:${customer.phone}`}
              className="inline-flex items-center gap-1 font-semibold text-primary underline"
            >
              <Phone aria-hidden="true" className="size-4" /> {customer.phone}
            </a>
            <a
              href={customerWhatsappUrl(customer.phone, order.number)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 font-semibold text-success underline"
            >
              <MessageCircle aria-hidden="true" className="size-4" /> WhatsApp
            </a>
          </p>
          <p>
            {customer.address} · <span className="font-semibold">{customer.neighborhood}</span>
          </p>
          {customer.note === '' ? null : (
            <p className="text-muted-foreground">Nota: {customer.note}</p>
          )}
        </div>
        <ul className="grid gap-0.5 rounded-md bg-muted/50 px-3 py-2 text-sm">
          {order.lines.map((line) => (
            <li key={line.productId} className="flex justify-between gap-2">
              <span>
                {line.quantity} × {line.name}
              </span>
              <span className="tabular-nums">{formatCOP(line.total)}</span>
            </li>
          ))}
          <li className="text-muted-foreground">Domicilio: a confirmar</li>
        </ul>
        {canManage && next !== null ? (
          <div>
            <Button onClick={() => onAdvance(next)} disabled={advancing}>
              {advancing ? <Spinner className="size-4" /> : null} {NEXT_ACTION_LABEL[order.status]}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Pedidos que llegan desde la web pública: se ven en vivo y se avanzan por estados. */
export function WebOrdersPage() {
  const queryClient = useQueryClient();
  const canManage = useCan('web-orders:manage');
  const [status, setStatus] = useState<WebOrderStatus | undefined>(undefined);

  const orders = useQuery({
    queryKey: webOrderKeys.list({ status }),
    queryFn: ({ signal }) => listWebOrders({ status }, signal),
    refetchInterval: POLL_MS,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: webOrderKeys.all });
  }, [queryClient]);
  const live = useWebOrdersRealtime(refresh);

  const advance = useMutation({
    mutationFn: updateWebOrderStatus,
    onSuccess: (order) => {
      toast.success(`Pedido #${String(order.number)}: ${WEB_ORDER_STATUS_LABELS[order.status]}`);
      refresh();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      refresh();
    },
  });

  const filters: (WebOrderStatus | undefined)[] = [undefined, ...WEB_ORDER_STATUSES];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Pedidos web"
        description={
          live === 'live'
            ? 'Pedidos de hoy y los que siguen sin entregar. Se actualiza en vivo.'
            : 'Pedidos de hoy y los que siguen sin entregar. Se actualiza cada 30 segundos.'
        }
      />

      <div className="mb-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Filtrar por estado">
        {filters.map((item) => (
          <button
            key={item ?? 'todos'}
            type="button"
            role="radio"
            aria-checked={status === item}
            onClick={() => {
              setStatus(item);
            }}
            className={cn(
              'h-10 rounded-full border px-4 text-sm font-bold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              status === item
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card',
            )}
          >
            {item === undefined ? 'Todos' : WEB_ORDER_STATUS_LABELS[item]}
          </button>
        ))}
      </div>

      {orders.isPending ? (
        <Skeleton className="h-64" />
      ) : orders.isError ? (
        <ErrorState
          description={errorMessage(orders.error)}
          onRetry={() => void orders.refetch()}
        />
      ) : orders.data.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="No hay pedidos"
          description={
            status === undefined
              ? 'Cuando alguien haga un pedido desde la web, aparecerá aquí.'
              : 'No hay pedidos en este estado.'
          }
        />
      ) : (
        <ul className="grid gap-3">
          {sortWebOrders(orders.data).map((order) => (
            <li key={order.id}>
              <OrderCard
                order={order}
                canManage={canManage}
                advancing={advance.isPending && advance.variables.id === order.id}
                onAdvance={(next) => {
                  advance.mutate({ id: order.id, status: next });
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
