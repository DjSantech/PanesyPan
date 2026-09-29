import { negocio } from '@/config/negocio';
import type { ContactInfo } from '@/lib/business';
import { getSiteUrl } from './site';

type JsonLd = Record<string, unknown>;

/** Quita propiedades vacías: nunca se publican datos inexistentes. */
function compact(obj: JsonLd): JsonLd {
  const out: JsonLd = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** schema.org Bakery a partir de negocio.ts y los datos de contacto. */
export function bakeryJsonLd(contact: ContactInfo): JsonLd {
  const url = getSiteUrl();
  const logo = `${url}/logo-panesypan-320.webp`;
  const coords = negocio.coordinates;
  return compact({
    '@context': 'https://schema.org',
    '@type': 'Bakery',
    '@id': `${url}/#negocio`,
    name: contact.name,
    // Como aparece en Google Maps (con "y" en lugar de "&").
    alternateName: 'Panes y Pan',
    url,
    logo,
    image: [logo, `${url}/opengraph-image`],
    telephone: contact.phone.trim(),
    address: compact({
      '@type': 'PostalAddress',
      streetAddress: contact.address.trim(),
      addressLocality: 'Dosquebradas',
      addressRegion: 'Risaralda',
      addressCountry: 'CO',
    }),
    geo: coords
      ? { '@type': 'GeoCoordinates', latitude: coords.lat, longitude: coords.lng }
      : undefined,
    openingHours: negocio.openingHours.map((h) => h.schema),
    hasMap: contact.mapUrl,
    sameAs: [negocio.instagram, negocio.facebook, negocio.tiktok].filter(Boolean),
    areaServed: 'Dosquebradas, Risaralda',
  });
}

/** BreadcrumbList Inicio → página. */
export function breadcrumbJsonLd(name: string, path: string): JsonLd {
  const url = getSiteUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${url}/` },
      { '@type': 'ListItem', position: 2, name, item: `${url}${path}` },
    ],
  };
}
