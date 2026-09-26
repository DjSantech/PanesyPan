import { mockBusiness, mockCatalog, mockDailyMenu } from './mock';
import type { BusinessResponse, CatalogResponse, DailyMenuResponse } from './types';

/** URL base de la API sin barra final, o null si no está configurada. */
export function getApiUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

/**
 * Pide una ruta pública con la revalidación del contrato (docs/web/CONTRATOS.md, "Caché").
 * Si no hay API configurada o la petición falla, usa los datos de ejemplo.
 */
async function fetchPublic<T>(path: string, revalidate: number, fallback: () => T): Promise<T> {
  const base = getApiUrl();
  if (!base) return fallback();
  try {
    const res = await fetch(`${base}/api/v1/public/${path}`, { next: { revalidate } });
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    return (await res.json()) as T;
  } catch (error) {
    console.error(`No se pudo cargar /public/${path}; se usan datos de ejemplo.`, error);
    return fallback();
  }
}

export function getCatalog(): Promise<CatalogResponse> {
  return fetchPublic('catalogo', 300, () => mockCatalog);
}

export function getDailyMenu(): Promise<DailyMenuResponse> {
  return fetchPublic('menu-del-dia', 60, mockDailyMenu);
}

export function getBusiness(): Promise<BusinessResponse> {
  return fetchPublic('negocio', 3600, () => mockBusiness);
}

/** Convierte la ruta relativa de una foto en URL absoluta de la API. */
export function resolveImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  if (/^https?:\/\//.test(imageUrl)) return imageUrl;
  const base = getApiUrl();
  return base ? `${base}${imageUrl}` : null;
}
