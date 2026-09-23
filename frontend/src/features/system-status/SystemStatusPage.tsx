import type { DatabaseHealthResponse, HealthResponse } from '@panesypan/shared';
import { formatTimeCO } from '@panesypan/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { formatUptime } from '@/lib/format';
import { fetchApiHealth, fetchDatabaseHealth } from './health.api';

const REFRESH_INTERVAL_MS = 30_000;

type Tone = 'ok' | 'error' | 'pending';

interface StatusView {
  tone: Tone;
  label: string;
  detail: string;
}

const TONE_STYLES: Record<Tone, { dot: string; badge: string }> = {
  ok: { dot: 'bg-success', badge: 'bg-success-soft text-success' },
  error: { dot: 'bg-danger', badge: 'bg-danger-soft text-danger' },
  pending: { dot: 'bg-pending', badge: 'bg-pending-soft text-pending' },
};

const PENDING_VIEW: StatusView = {
  tone: 'pending',
  label: 'Verificando…',
  detail: 'Consultando el servidor',
};

function describeApi(query: UseQueryResult<HealthResponse>): StatusView {
  if (query.isError) {
    return { tone: 'error', label: 'Sin conexión', detail: query.error.message };
  }
  if (query.data === undefined) return PENDING_VIEW;
  const { version, uptimeSeconds } = query.data;
  return {
    tone: 'ok',
    label: 'En línea',
    detail: `Versión ${version} · activa desde hace ${formatUptime(uptimeSeconds)}`,
  };
}

function describeDatabase(query: UseQueryResult<DatabaseHealthResponse>): StatusView {
  if (query.isError) {
    return {
      tone: 'error',
      label: 'Sin datos',
      detail: 'No se pudo consultar porque la API no responde',
    };
  }
  if (query.data === undefined) return PENDING_VIEW;
  if (query.data.status === 'error') {
    return { tone: 'error', label: 'Caída', detail: 'La API no logra conectarse a MongoDB' };
  }
  return {
    tone: 'ok',
    label: 'En línea',
    detail: `MongoDB responde en ${String(query.data.latencyMs)} ms`,
  };
}

function StatusRow({ title, view }: { title: string; view: StatusView }) {
  const styles = TONE_STYLES[view.tone];
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-border bg-background p-4">
      <span aria-hidden="true" className={`mt-1.5 size-3 shrink-0 rounded-full ${styles.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{title}</p>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles.badge}`}>
            {view.label}
          </span>
        </div>
        <p className="mt-1 text-sm break-words text-muted-foreground">{view.detail}</p>
      </div>
    </li>
  );
}

export function SystemStatusPage() {
  const apiHealth = useQuery({
    queryKey: ['health', 'api'],
    queryFn: ({ signal }) => fetchApiHealth(signal),
    refetchInterval: REFRESH_INTERVAL_MS,
  });
  const databaseHealth = useQuery({
    queryKey: ['health', 'database'],
    queryFn: ({ signal }) => fetchDatabaseHealth(signal),
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const isChecking = apiHealth.isFetching || databaseHealth.isFetching;
  const lastCheckedAt = Math.max(
    apiHealth.dataUpdatedAt,
    apiHealth.errorUpdatedAt,
    databaseHealth.dataUpdatedAt,
    databaseHealth.errorUpdatedAt,
  );

  const checkNow = () => {
    void apiHealth.refetch();
    void databaseHealth.refetch();
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <section
        aria-labelledby="status-title"
        className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8"
      >
        <header className="flex flex-col items-center gap-4 text-center">
          <img
            src="/logo-panesypan-320.webp"
            alt="Logo de la panadería"
            width={160}
            height={160}
            className="size-40 rounded-full"
          />
          <div>
            <h1 id="status-title" className="text-2xl font-bold tracking-tight">
              Sistema PanesYPan
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Estado de la plataforma</p>
          </div>
        </header>

        <ul className="mt-8 space-y-3" aria-live="polite">
          <StatusRow title="API" view={describeApi(apiHealth)} />
          <StatusRow title="Base de datos" view={describeDatabase(databaseHealth)} />
        </ul>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {lastCheckedAt > 0
              ? `Última verificación: ${formatTimeCO(new Date(lastCheckedAt))}`
              : 'Verificando…'}
          </p>
          <button
            type="button"
            onClick={checkNow}
            disabled={isChecking}
            className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait disabled:opacity-60"
          >
            {isChecking ? 'Verificando…' : 'Verificar ahora'}
          </button>
        </div>
      </section>
    </main>
  );
}
