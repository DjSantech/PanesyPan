import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTIONS,
  formatCOP,
  formatDateTimeCO,
  SECURITY_ALERT_ACTIONS,
  USER_ROLE_LABELS,
  type AuditAction,
  type AuditLog,
} from '@panesypan/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ScrollText, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, PageHeader, Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Badge, Card, Skeleton } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import { auditKeys, listAuditLogs, type AuditFilters } from './audit.api';

const REASON_LABELS: Record<string, string> = {
  BAD_PASSWORD: 'contraseña incorrecta',
  UNKNOWN_USER: 'usuario inexistente',
  INACTIVE: 'usuario desactivado',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'nombre',
  email: 'correo',
  role: 'rol',
  price: 'precio',
  category: 'categoría',
  isFavorite: 'favorito',
  trackStock: 'controla inventario',
  isActive: 'activo',
  kind: 'tipo',
  legalName: 'razón social',
  taxId: 'NIT',
  address: 'dirección',
  phone: 'teléfono',
  ticketFooter: 'pie del tiquete',
  ticketWidth: 'ancho del papel',
  tableCount: 'mesas',
  maxCashierDiscountPercent: 'descuento máximo sin PIN',
};

const PURPOSE_LABELS: Record<string, string> = {
  DISCOUNT: 'para un descuento',
  VOID: 'para anular una venta',
  CANCEL_TAB: 'para cancelar una mesa',
  PURCHASE_VOID: 'para anular una compra',
};

/** Formatea el valor de un cambio según el campo (precios en pesos, sí/no, roles…). */
function formatChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(vacío)';
  if (field === 'price' && typeof value === 'number') return formatCOP(value);
  if (field === 'maxCashierDiscountPercent' && typeof value === 'number')
    return `${String(value)} %`;
  if (field === 'ticketWidth' && typeof value === 'string') return `${value} mm`;
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  if (field === 'role' && typeof value === 'string' && value in USER_ROLE_LABELS) {
    return USER_ROLE_LABELS[value as keyof typeof USER_ROLE_LABELS];
  }
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/** Resumen legible de los detalles guardados en cada evento. */
function describeDetails(log: AuditLog): string | null {
  const { metadata } = log;
  const parts: string[] = [];
  if (typeof metadata.reason === 'string')
    parts.push(REASON_LABELS[metadata.reason] ?? metadata.reason);
  if (typeof metadata.identifier === 'string') parts.push(`intentó con "${metadata.identifier}"`);
  if (typeof metadata.attempts === 'number') parts.push(`intento ${String(metadata.attempts)}`);
  if (typeof metadata.sessionsClosed === 'number' && metadata.sessionsClosed > 0) {
    parts.push(`${String(metadata.sessionsClosed)} sesiones cerradas`);
  }
  if (typeof metadata.lockedUntil === 'string') {
    parts.push(`bloqueada hasta ${formatDateTimeCO(new Date(metadata.lockedUntil))}`);
  }
  if (metadata.changes !== null && typeof metadata.changes === 'object') {
    for (const [field, change] of Object.entries(
      metadata.changes as Record<string, { from: unknown; to: unknown }>,
    )) {
      parts.push(
        `${FIELD_LABELS[field] ?? field}: ${formatChangeValue(field, change.from)} → ${formatChangeValue(field, change.to)}`,
      );
    }
  }
  if (typeof metadata.isAvailable === 'boolean') {
    parts.push(metadata.isAvailable ? 'marcado como disponible' : 'marcado como agotado');
  }
  if (typeof metadata.price === 'number') parts.push(`precio ${formatCOP(metadata.price)}`);
  if (typeof metadata.table === 'number') parts.push(`mesa ${String(metadata.table)}`);
  if (typeof metadata.product === 'string') {
    const quantity = typeof metadata.quantity === 'number' ? `${String(metadata.quantity)} × ` : '';
    parts.push(`quitó ${quantity}${metadata.product}`);
  }
  if (typeof metadata.total === 'number') parts.push(`valor ${formatCOP(metadata.total)}`);
  if (typeof metadata.discount === 'number')
    parts.push(`descuento ${formatCOP(metadata.discount)}`);
  if (typeof metadata.openingAmount === 'number') {
    parts.push(`base ${formatCOP(metadata.openingAmount)}`);
  }
  if (typeof metadata.purpose === 'string') {
    parts.push(PURPOSE_LABELS[metadata.purpose] ?? metadata.purpose);
  }
  if (typeof metadata.note === 'string') parts.push(`motivo: “${metadata.note}”`);
  if (typeof metadata.approvedBy === 'string') parts.push(`autorizó ${metadata.approvedBy}`);
  if (metadata.source === 'SEED_ADMIN') parts.push('administrador inicial');
  if (metadata.source === 'SCRIPT') parts.push('restablecida por script de recuperación');
  return parts.length > 0 ? parts.join(' · ') : null;
}

function AuditItem({ log }: { log: AuditLog }) {
  const isAlert = SECURITY_ALERT_ACTIONS.includes(log.action);
  const details = describeDetails(log);
  return (
    <li className={cn('grid gap-1 px-4 py-3.5', isAlert && 'bg-danger-soft/60')}>
      <div className="flex flex-wrap items-center gap-2">
        {isAlert ? (
          <ShieldAlert className="size-4.5 text-danger" aria-label="Alerta de seguridad" />
        ) : null}
        <span className="font-extrabold">{AUDIT_ACTION_LABELS[log.action]}</span>
        {log.entity !== null && log.entity.label !== null ? (
          <Badge>
            {log.entity.type === 'USER' ? '@' : ''}
            {log.entity.label}
          </Badge>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        <time dateTime={log.createdAt}>{formatDateTimeCO(new Date(log.createdAt))}</time>
        {' · '}
        {log.actor === null
          ? 'Sistema / sin sesión'
          : `${log.actor.name} (${USER_ROLE_LABELS[log.actor.role]})`}
        {log.ip === null ? '' : ` · IP ${log.ip}`}
      </p>
      {details === null ? null : <p className="text-sm">{details}</p>}
    </li>
  );
}

export function AuditPage() {
  const [filters, setFilters] = useState<AuditFilters>({});
  const hasFilters =
    filters.action !== undefined || (filters.from ?? '') !== '' || (filters.to ?? '') !== '';

  const logs = useInfiniteQuery({
    queryKey: auditKeys.list(filters),
    queryFn: ({ pageParam, signal }) => listAuditLogs(filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const items = logs.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div>
      <PageHeader
        title="Auditoría"
        description="Registro de ingresos, cambios de usuarios y alertas de seguridad."
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <Field id="audit-action" label="Acción">
            <NativeSelect
              id="audit-action"
              value={filters.action ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                setFilters((current) => ({
                  ...current,
                  action: value === '' ? undefined : (value as AuditAction),
                }));
              }}
            >
              <option value="">Todas las acciones</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {AUDIT_ACTION_LABELS[action]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="audit-from" label="Desde">
            <Input
              id="audit-from"
              type="date"
              value={filters.from ?? ''}
              max={filters.to}
              onChange={(event) => {
                setFilters((current) => ({ ...current, from: event.target.value }));
              }}
            />
          </Field>
          <Field id="audit-to" label="Hasta">
            <Input
              id="audit-to"
              type="date"
              value={filters.to ?? ''}
              min={filters.from}
              onChange={(event) => {
                setFilters((current) => ({ ...current, to: event.target.value }));
              }}
            />
          </Field>
          <Button
            variant="ghost"
            disabled={!hasFilters}
            onClick={() => {
              setFilters({});
            }}
          >
            <X aria-hidden="true" /> Limpiar
          </Button>
        </div>
      </Card>

      {logs.isPending ? (
        <Card aria-busy="true" aria-label="Cargando auditoría">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="grid gap-2 border-b border-border px-4 py-4 last:border-0">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3.5 w-80 max-w-full" />
            </div>
          ))}
        </Card>
      ) : logs.isError ? (
        <ErrorState
          description={errorMessage(logs.error)}
          onRetry={() => {
            void logs.refetch();
          }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No hay eventos"
          description={hasFilters ? 'Prueba con otros filtros.' : undefined}
        />
      ) : (
        <>
          <Card>
            <ul className="divide-y divide-border">
              {items.map((log) => (
                <AuditItem key={log.id} log={log} />
              ))}
            </ul>
          </Card>
          {logs.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                onClick={() => {
                  void logs.fetchNextPage();
                }}
                disabled={logs.isFetchingNextPage}
              >
                {logs.isFetchingNextPage ? <Spinner /> : null}
                Cargar más
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
