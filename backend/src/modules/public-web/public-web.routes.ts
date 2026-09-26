import {
  publicBusinessResponseSchema,
  publicCatalogResponseSchema,
  publicDailyMenuResponseSchema,
} from '@panesypan/shared';
import { Router } from 'express';
import { getPublicBusiness, getPublicCatalog, getPublicDailyMenu } from './public-web.service';

/** Cache-Control de cada ruta (docs/web/CONTRATOS.md, tabla de caché). */
export const PUBLIC_WEB_CACHE = {
  catalog: 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  dailyMenu: 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
  business: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
} as const;

/**
 * /api/v1/public (sin sesión), lectura para la web pública
 *   GET /catalogo       productos visibles en la web
 *   GET /menu-del-dia   menú de hoy (menu: null si no está publicado)
 *   GET /negocio        nombre, dirección y teléfono
 * Cada respuesta se valida con el esquema estricto de shared: nunca sale un campo interno.
 */
export function createPublicWebRouter(): Router {
  const router = Router();

  router.get('/catalogo', async (_req, res) => {
    const body = publicCatalogResponseSchema.parse(await getPublicCatalog());
    res.set('Cache-Control', PUBLIC_WEB_CACHE.catalog).json(body);
  });

  router.get('/menu-del-dia', async (_req, res) => {
    const body = publicDailyMenuResponseSchema.parse(await getPublicDailyMenu());
    res.set('Cache-Control', PUBLIC_WEB_CACHE.dailyMenu).json(body);
  });

  router.get('/negocio', async (_req, res) => {
    const body = publicBusinessResponseSchema.parse(await getPublicBusiness());
    res.set('Cache-Control', PUBLIC_WEB_CACHE.business).json(body);
  });

  return router;
}
