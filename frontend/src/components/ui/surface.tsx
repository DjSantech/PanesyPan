import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'rounded-2xl border border-border bg-card text-card-foreground shadow-xs',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('grid gap-1 p-5 pb-0', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-lg leading-tight font-extrabold', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-5', className)} {...props} />;
}

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap [&_svg]:size-3.5',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground',
        primary: 'bg-primary/12 text-primary',
        accent: 'bg-accent-soft text-accent-soft-foreground',
        success: 'bg-success-soft text-success',
        danger: 'bg-danger-soft text-danger',
        pending: 'bg-pending-soft text-pending',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-xl bg-muted', className)}
      {...props}
    />
  );
}

const alertVariants = cva(
  'flex gap-3 rounded-xl border p-3.5 text-sm [&_svg]:mt-0.5 [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        danger: 'border-danger/30 bg-danger-soft text-danger',
        info: 'border-border bg-muted text-foreground',
        success: 'border-success/30 bg-success-soft text-success',
        pending: 'border-pending/30 bg-pending-soft text-pending',
      },
    },
    defaultVariants: { tone: 'info' },
  },
);

export function Alert({
  className,
  tone,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    />
  );
}
