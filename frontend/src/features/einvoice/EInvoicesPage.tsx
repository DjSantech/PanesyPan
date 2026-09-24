import {
  EINVOICE_ENVIRONMENT_LABELS,
  EINVOICE_KIND_LABELS,
  EINVOICE_PROVIDER_LABELS,
  EINVOICE_STATUS_LABELS,
  EINVOICE_STATUSES,
  formatCOP,
  formatDateTimeCO,
  type EInvoiceStatus,
  type ElectronicDocument,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardContent, Skeleton } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { formatSaleNumber } from '../pos/receipt-format';
import { EInvoiceBadge } from './EInvoiceBadge';
import { isEInvoiceInFlight } from './einvoice-logic';
import {
  einvoiceKeys,
  listElectronicDocuments,
  retryElectronicDocument,
  useEInvoiceStatus,
} from './einvoice.api';

/** Mientras haya documentos en camino, la lista se refresca sola. */
const REFRESH_MS = 10_000;

function DocumentRow({
  document,
  onRetry,
  retrying,
}: {
  document: ElectronicDocument;
  onRetry: () => void;
  retrying: boolean;
}) {
  const canRetry = document.status === 'REJECTED' || document.status === 'FAILED';
  return (
    <li className="grid gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-extrabold">
          {EINVOICE_KIND_LABELS[document.kind]} {document.number ?? ''}
        </span>
        <EInvoiceBadge status={document.status} />
        <span className="text-sm text-muted-foreground">
          Venta #{formatSaleNumber(document.saleNumber)} · {document.customerName}
        </span>
        <span className="ml-auto font-extrabold tabular-nums">{formatCOP(document.total)}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {formatDateTimeCO(new Date(document.createdAt))}
        {document.attempts > 0 ? ` · ${String(document.attempts)} intento(s)` : ''}
        {document.nextAttemptAt === null || document.status !== 'PENDING'
          ? ''
          : ` · próximo intento ${formatDateTimeCO(new Date(document.nextAttemptAt))}`}
        {` · ${EINVOICE_ENVIRONMENT_LABELS[document.environment]}`}
      </p>
      {document.lastError === null || document.status === 'ACCEPTED' ? null : (
        <p
          className={cn(
            'text-sm',
            canRetry ? 'font-semibold text-danger' : 'text-muted-foreground',
          )}
        >
          {document.lastError}
        </p>
      )}
      {document.cufe === null ? null : (
        <p className="text-xs break-all text-muted-foreground">CUFE: {document.cufe}</p>
      )}
      {canRetry || document.publicUrl !== null ? (
        <div className="flex flex-wrap gap-2">
          {canRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
              {retrying ? <Spinner className="size-4" /> : <RotateCcw aria-hidden="true" />}{' '}
              Reenviar
            </Button>
          ) : null}
          {document.publicUrl === null ? null : (
            <Button size="sm" variant="ghost" asChild>
              <a href={document.publicUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink aria-hidden="true" /> Ver en el proveedor
              </a>
            </Button>
          )}
        </div>
      ) : null}
    </li>
  );
}

/** Facturas y notas crédito electrónicas: estado ante la DIAN y reenvío de las que fallaron. */
export function EInvoicesPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<EInvoiceStatus | undefined>(undefined);
  const summary = useEInvoiceStatus();
  const documents = useQuery({
    queryKey: einvoiceKeys.list({ status }),
    queryFn: ({ signal }) => listElectronicDocuments({ status }, signal),
    refetchInterval: (query) =>
      query.state.data?.some((item) => isEInvoiceInFlight(item.status)) === true
        ? REFRESH_MS
        : false,
  });

  const retry = useMutation({
    mutationFn: retryElectronicDocument,
    onSuccess: () => {
      toast.success('Documento en cola para reenviarse');
      void queryClient.invalidateQueries({ queryKey: einvoiceKeys.all });
    },
    onError: (error) => {
      toast.error(errorMessage(error));
    },
  });

  const counts = summary.data?.counts;
  const filters: (EInvoiceStatus | undefined)[] = [undefined, ...EINVOICE_STATUSES];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Facturación electrónica"
        description="Facturas y notas crédito de las ventas, y su estado ante la DIAN."
      />

      {summary.data === undefined ? null : (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4 text-sm">
            <span>
              <span className="font-bold">Estado:</span>{' '}
              {summary.data.enabled ? 'Activa' : 'Apagada'}
            </span>
            <span>
              <span className="font-bold">Proveedor:</span>{' '}
              {EINVOICE_PROVIDER_LABELS[summary.data.provider]}
            </span>
            <span>
              <span className="font-bold">Ambiente:</span>{' '}
              {EINVOICE_ENVIRONMENT_LABELS[summary.data.environment]}
            </span>
            <Link to="/configuracion" className="ml-auto font-bold text-primary underline">
              Configurar en Ajustes
            </Link>
          </CardContent>
        </Card>
      )}
      {summary.data?.enabled === true && !summary.data.providerReady ? (
        <Alert tone="danger" className="mb-4">
          El proveedor elegido no tiene credenciales en el servidor: las facturas no pueden salir.
        </Alert>
      ) : null}

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
            {item === undefined ? 'Todos' : EINVOICE_STATUS_LABELS[item]}
            {item === undefined || counts === undefined ? '' : ` (${String(counts[item])})`}
          </button>
        ))}
      </div>

      {documents.isPending ? (
        <Skeleton className="h-64" />
      ) : documents.isError ? (
        <ErrorState
          description={errorMessage(documents.error)}
          onRetry={() => void documents.refetch()}
        />
      ) : documents.data.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No hay documentos"
          description={
            status === undefined
              ? 'Cuando se active la facturación electrónica, aquí aparecerá cada venta facturada.'
              : 'No hay documentos en este estado.'
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {documents.data.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                retrying={retry.isPending && retry.variables === document.id}
                onRetry={() => {
                  retry.mutate(document.id);
                }}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
