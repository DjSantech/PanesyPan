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

/** Imagen para compartir (web/src/app/opengraph-image.tsx), la misma en todas las páginas. */
const SHARE_IMAGE = { url: '/opengraph-image', width: 1200, height: 630, alt: BUSINESS_NAME };

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
      // Al definir openGraph por página, Next no hereda la imagen del inicio: se repite aquí.
      images: [SHARE_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [SHARE_IMAGE.url],
    },
  };
}

/** Páginas públicas indexables (sitemap). */
export const PUBLIC_PATHS = ['/', '/menu', '/menu-del-dia', '/nosotros', '/contacto'] as const;
