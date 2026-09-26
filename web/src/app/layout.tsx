import '@fontsource-variable/nunito-sans';
import '@fontsource-variable/playfair-display';
import './globals.css';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { getContactInfo } from '@/lib/business';
import { BUSINESS_NAME } from '@panesypan/shared';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: {
    default: `${BUSINESS_NAME} · Panadería en Dosquebradas`,
    template: `%s · ${BUSINESS_NAME}`,
  },
  description:
    'Panadería en Dosquebradas, Risaralda: pan fresco, productos de panadería y menú del día.',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const contact = await getContactInfo();
  return (
    <html lang="es-CO">
      <body className="flex min-h-dvh flex-col">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Saltar al contenido
        </a>
        <SiteHeader businessName={contact.name} />
        <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          {children}
        </main>
        <SiteFooter contact={contact} />
      </body>
    </html>
  );
}
