import {
  adjustStockRequestSchema,
  listInventoryQuerySchema,
  listMovementsQuerySchema,
  registerProductionRequestSchema,
  registerSelfConsumptionRequestSchema,
  registerWasteRequestSchema,
  setMinStockRequestSchema,
  type InventoryItem,
} from '@panesypan/shared';
import { userCan } from '../profiles/effective-permissions';
import { Router, type Request } from 'express';
import type { Logger } from 'pino';
import { getRequestMeta } from '../../lib/request-meta';
import { parseBody, parseIdParam, parseQuery } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import type { ActorContext } from '../users/users.service';
import {
  adjustStock,
  listInventory,
  listMovements,
  registerProduction,
  registerSelfConsumption,
  registerWaste,
  setMinStock,
} from './inventory.service';

export interface InventoryRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  logger?: Logger;
}

/**
 * /api/v1/inventory
 *   GET  /                        existencias (?lowStock=true) · inventory:read
 *   GET  /movements               movimientos del día · inventory:read
 *   POST /production              producción del día · inventory:record
 *   POST /waste                   merma · inventory:record
 *   POST /adjustments             conteo físico · inventory:manage
 *   PATCH /:productId/min-stock   stock mínimo para la alerta · inventory:manage
 */
export function createInventoryRouter(deps: InventoryRouterDeps): Router {
  const { config, guards, logger } = deps;
  const router = Router();
  const canRead = [guards.authenticate(), guards.requirePermission('inventory:read')];
  const canRecord = [guards.authenticate(), guards.requirePermission('inventory:record')];
  const canManage = [guards.authenticate(), guards.requirePermission('inventory:manage')];

  const actorContext = (req: Request): ActorContext => {
    const ctx: ActorContext = {
      actor: getAuth(req).user,
      meta: getRequestMeta(req, config.trustCloudflareHeader),
    };
    if (logger !== undefined) ctx.logger = logger;
    return ctx;
  };

  /** El costo y el valor del inventario los ve solo quien administra el inventario. */
  const canSeeCost = (req: Request): boolean => userCan(getAuth(req).user, 'inventory:manage');
  const itemForViewer = (req: Request, item: InventoryItem): InventoryItem =>
    canSeeCost(req) ? item : { ...item, cost: null };

  router.get('/', ...canRead, async (req, res) => {
    const result = await listInventory(parseQuery(req, listInventoryQuerySchema));
    res.json(
      canSeeCost(req)
        ? result
        : {
            ...result,
            items: result.items.map((item) => itemForViewer(req, item)),
            totalValue: null,
          },
    );
  });
  router.get('/movements', ...canRead, async (req, res) => {
    res.json({ items: await listMovements(parseQuery(req, listMovementsQuerySchema)) });
  });
  router.post('/production', ...canRecord, async (req, res) => {
    const input = parseBody(req, registerProductionRequestSchema);
    res
      .status(201)
      .json({ item: itemForViewer(req, await registerProduction(input, actorContext(req))) });
  });
  router.post('/waste', ...canRecord, async (req, res) => {
    const input = parseBody(req, registerWasteRequestSchema);
    res
      .status(201)
      .json({ item: itemForViewer(req, await registerWaste(input, actorContext(req))) });
  });
  router.post('/self-consumption', ...canRecord, async (req, res) => {
    const input = parseBody(req, registerSelfConsumptionRequestSchema);
    res
      .status(201)
      .json({ item: itemForViewer(req, await registerSelfConsumption(input, actorContext(req))) });
  });
  router.post('/adjustments', ...canManage, async (req, res) => {
    const input = parseBody(req, adjustStockRequestSchema);
    res.status(201).json({ item: await adjustStock(input, actorContext(req)) });
  });
  router.patch('/:productId/min-stock', ...canManage, async (req, res) => {
    const input = parseBody(req, setMinStockRequestSchema);
    res.json({
      item: await setMinStock(parseIdParam(req, 'productId'), input, actorContext(req)),
    });
  });

  return router;
}
