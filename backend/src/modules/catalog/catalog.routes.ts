import {
  businessDateSchema,
  createCategoryRequestSchema,
  createProductRequestSchema,
  hasPermission,
  listProductsQuerySchema,
  PRODUCT_IMAGE_TYPES,
  reorderCategoriesRequestSchema,
  setAvailabilityRequestSchema,
  updateCategoryRequestSchema,
  updateProductRequestSchema,
  upsertDailyMenuRequestSchema,
} from '@panesypan/shared';
import express, { Router, type Request } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getRequestMeta } from '../../lib/request-meta';
import { parseBody, parseIdParam, parseQuery } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import { adjustStock } from '../inventory/inventory.service';
import type { ActorContext } from '../users/users.service';
import {
  createCategory,
  createProduct,
  getProduct,
  listCategories,
  listProducts,
  removeProductImage,
  reorderCategories,
  setProductImage,
  setProductAvailability,
  updateCategory,
  updateProduct,
} from './catalog.service';
import { getDailyMenu, upsertDailyMenu } from './daily-menu.service';

export interface CatalogRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  logger?: Logger;
}

const listCategoriesQuerySchema = z.strictObject({ all: z.enum(['true', 'false']).optional() });

function parseDateParam(req: Request): string {
  const result = businessDateSchema.safeParse(req.params.date);
  if (!result.success)
    throw new AppError(400, 'VALIDATION_ERROR', 'La fecha debe tener el formato AAAA-MM-DD');
  return result.data;
}

/**
 * /api/v1
 *   Categorías: GET /categories · POST /categories · PATCH /categories/:id · PUT /categories/order
 *   Productos:  GET /products · GET /products/:id · POST /products · PATCH /products/:id
 *               PATCH /products/:id/availability (también la cajera)
 *               POST|DELETE /products/:id/image (cuerpo = la imagen, máximo 2 MB)
 *   Menú:       GET /daily-menus/:date · PUT /daily-menus/:date
 */
export function createCatalogRouter(deps: CatalogRouterDeps): Router {
  const { config, guards, logger } = deps;
  const router = Router();
  const canRead = [guards.authenticate(), guards.requirePermission('catalog:read')];
  const canManage = [guards.authenticate(), guards.requirePermission('catalog:manage')];

  const actorContext = (req: Request): ActorContext => {
    const ctx: ActorContext = {
      actor: getAuth(req).user,
      meta: getRequestMeta(req, config.trustCloudflareHeader),
    };
    if (logger !== undefined) ctx.logger = logger;
    return ctx;
  };

  // ── Categorías ──
  router.get('/categories', ...canRead, async (req, res) => {
    const { all } = parseQuery(req, listCategoriesQuerySchema);
    // Las categorías desactivadas solo las ve quien administra el catálogo.
    const includeInactive =
      all === 'true' && hasPermission(getAuth(req).user.role, 'catalog:manage');
    res.json({ items: await listCategories(includeInactive) });
  });
  router.post('/categories', ...canManage, async (req, res) => {
    const input = parseBody(req, createCategoryRequestSchema);
    res.status(201).json({ category: await createCategory(input, actorContext(req)) });
  });
  router.put('/categories/order', ...canManage, async (req, res) => {
    const { ids } = parseBody(req, reorderCategoriesRequestSchema);
    res.json({ items: await reorderCategories(ids, actorContext(req)) });
  });
  router.patch('/categories/:id', ...canManage, async (req, res) => {
    const input = parseBody(req, updateCategoryRequestSchema);
    res.json({ category: await updateCategory(parseIdParam(req), input, actorContext(req)) });
  });

  // ── Productos ──
  router.get('/products', ...canRead, async (req, res) => {
    const query = parseQuery(req, listProductsQuerySchema);
    res.json({ items: await listProducts(query) });
  });
  router.get('/products/:id', ...canRead, async (req, res) => {
    res.json({ product: await getProduct(parseIdParam(req)) });
  });
  router.post('/products', ...canManage, async (req, res) => {
    const input = parseBody(req, createProductRequestSchema);
    const ctx = actorContext(req);
    const product = await createProduct(input, ctx);
    // El stock inicial queda como un ajuste en el libro de inventario (con quién y cuándo).
    if (product.trackStock && input.initialStock !== null && input.initialStock > 0) {
      await adjustStock(
        {
          productId: product.id,
          newQuantity: input.initialStock,
          note: 'Stock inicial al crear el producto',
        },
        ctx,
      );
    }
    res.status(201).json({ product });
  });
  router.patch('/products/:id', ...canManage, async (req, res) => {
    const input = parseBody(req, updateProductRequestSchema);
    res.json({ product: await updateProduct(parseIdParam(req), input, actorContext(req)) });
  });
  // La imagen llega tal cual en el cuerpo (el navegador ya la redujo); el tipo real se valida.
  router.post(
    '/products/:id/image',
    ...canManage,
    express.raw({ type: [...PRODUCT_IMAGE_TYPES], limit: '2mb' }),
    async (req, res) => {
      const data: unknown = req.body;
      if (!Buffer.isBuffer(data)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Envía la imagen en formato JPG, PNG o WebP.');
      }
      res.json({ product: await setProductImage(parseIdParam(req), data, actorContext(req)) });
    },
  );
  router.delete('/products/:id/image', ...canManage, async (req, res) => {
    res.json({ product: await removeProductImage(parseIdParam(req), actorContext(req)) });
  });
  router.patch(
    '/products/:id/availability',
    guards.authenticate(),
    guards.requirePermission('catalog:availability'),
    async (req, res) => {
      const { isAvailable } = parseBody(req, setAvailabilityRequestSchema);
      res.json({
        product: await setProductAvailability(parseIdParam(req), isAvailable, actorContext(req)),
      });
    },
  );

  // ── Menú del día ──
  router.get('/daily-menus/:date', ...canRead, async (req, res) => {
    res.json({ menu: await getDailyMenu(parseDateParam(req)) });
  });
  router.put('/daily-menus/:date', ...canManage, async (req, res) => {
    const input = parseBody(req, upsertDailyMenuRequestSchema);
    res.json({ menu: await upsertDailyMenu(parseDateParam(req), input, actorContext(req)) });
  });

  return router;
}
