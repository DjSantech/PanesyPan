import type { ReactNode } from 'react';

export function PageHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
      {children && <p className="mt-2 max-w-2xl text-lg text-muted-foreground">{children}</p>}
    </div>
  );
}
