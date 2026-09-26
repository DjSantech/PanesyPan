import { BUSINESS_NAME } from '@panesypan/shared';
import type { Metadata } from 'next';

const FALLBACK_SITE_URL = 'https://panesypan.com';

/** URL pública del sitio, sin barra final. */
export function getSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim();
  return (raw === '' ? FALLBACK_SITE_URL : raw).replace(/\/+$/, '');
}

export const SITE_NAME = BUSINESS_NAME;
export const SITE_LOCALE = 'es_CO';

export interface PageSeo {
  /** Título sin el sufijo de la marca. */
  title: string;
  description: string;
  /** Ruta desde la raíz, ej. "/menu". */
  path: string;
}

/** Metadatos por página: título, canonical, Open Graph y Twitter coherentes. */
export function pageMetadata({ title, description, path }: PageSeo): Metadata {
  const fullTitle = `${title} | ${SITE_NAME}`;
  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      locale: SITE_LOCALE,
      siteName: SITE_NAME,
      title: fullTitle,
      description,
      url: path,
    },
    twitter: { card: 'summary_large_image', title: fullTitle, description },
  };
}

/** Páginas públicas indexables (sitemap). */
export const PUBLIC_PATHS = ['/', '/menu', '/menu-del-dia', '/nosotros', '/contacto'] as const;
