import '@fontsource-variable/nunito-sans';
import '@fontsource-variable/playfair-display';
import './globals.css';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import { getContactInfo } from '@/lib/business';
import { JsonLdScript } from '@/lib/seo/JsonLdScript';
import { bakeryJsonLd } from '@/lib/seo/jsonld';
import { SITE_LOCALE, getSiteUrl } from '@/lib/seo/site';
import { BUSINESS_NAME } from '@panesypan/shared';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: `Panadería en Dosquebradas | ${BUSINESS_NAME}`,
    template: `%s | ${BUSINESS_NAME}`,
  },
  description:
    'Panadería en Dosquebradas, Risaralda: pan fresco, productos de panadería y menú del día.',
  applicationName: BUSINESS_NAME,
  openGraph: { type: 'website', locale: SITE_LOCALE, siteName: BUSINESS_NAME },
  twitter: { card: 'summary_large_image' },
};

/** Aplica el tema guardado antes de pintar, para que no parpadee (claro por defecto). */
const THEME_SCRIPT = `try{if(localStorage.getItem('${THEME_STORAGE_KEY}')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const contact = await getContactInfo();
  return (
    <html lang="es-CO" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <JsonLdScript data={bakeryJsonLd(contact)} />
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
