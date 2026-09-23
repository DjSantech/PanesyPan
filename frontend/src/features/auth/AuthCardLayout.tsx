import type { ReactNode } from 'react';
import { BrandLogo } from '@/components/BrandLogo';

/** Pantalla centrada con el logo: login, cambio de contraseña y creación del PIN. */
export function AuthCardLayout({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandLogo size={112} />
          <h1 className="font-display text-3xl font-bold">{title}</h1>
          {description === undefined ? null : (
            <p className="text-muted-foreground">{description}</p>
          )}
        </div>
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
