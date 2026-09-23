import { CircleAlert, LoaderCircle, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function Spinner({
  className,
  label = 'Cargando…',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2', className)}>
      <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function FullScreenLoader({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background text-muted-foreground">
      <div className="flex flex-col items-center gap-3">
        <LoaderCircle className="size-8 animate-spin text-primary" aria-hidden="true" />
        <p role="status" className="text-sm font-semibold">
          {label}
        </p>
      </div>
    </div>
  );
}

interface StateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: StateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center',
        className,
      )}
    >
      {Icon === undefined ? null : (
        <Icon className="size-8 text-muted-foreground" aria-hidden="true" />
      )}
      <p className="font-extrabold">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'No se pudo cargar la información',
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-2 rounded-2xl border border-danger/30 bg-danger-soft px-6 py-8 text-center text-danger',
        className,
      )}
    >
      <CircleAlert className="size-7" aria-hidden="true" />
      <p className="font-extrabold">{title}</p>
      {description === undefined ? null : <p className="max-w-sm text-sm">{description}</p>}
      {onRetry === undefined ? null : (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RefreshCw /> Reintentar
        </Button>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="grid gap-1">
        <h1 className="font-display text-3xl leading-tight font-bold">{title}</h1>
        {description === undefined ? null : <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions === undefined ? null : <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
