import {
  createPurchaseRequestSchema,
  createSupplierReturnRequestSchema,
  listPurchasesQuerySchema,
  voidPurchaseRequestSchema,
} from '@panesypan/shared';
import { Router, type Request, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import { getRequestMeta } from '../../lib/request-meta';
import { parseBody, parseQuery } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import type { PosContext } from '../sales/approval.service';
import {
  createPurchase,
  createSupplierReturn,
  getOrderSuggestions,
  listPurchases,
  listSupplierReturns,
  voidPurchase,
} from './purchases.service';

export interface PurchasesRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  /** Límite de intentos para las peticiones que traen el PIN de un administrador. */
  approvalLimiter: RequestHandler;
  logger?: Logger;
}

/**
 * /api/v1 (los proveedores están en /suppliers, módulo suppliers)
 *   GET   /purchases?from=&to=&supplierId=   compras de un rango de días
 *   POST  /purchases                  registrar una compra de contado
 *   GET   /purchases/order-suggestions      qué pedirle a cada proveedor (admin)
 *   POST  /purchases/:id/void         anular una compra (PIN de administrador y motivo)
 *   GET   /supplier-returns?from=&to=&supplierId=   devoluciones a proveedor de un rango
 *   POST  /supplier-returns           registrar una devolución a proveedor
 */
export function createPurchasesRouter(deps: PurchasesRouterDeps): Router {
  const { config, guards, approvalLimiter, logger } = deps;
  const router = Router();
  const canRecord = [guards.authenticate(), guards.requirePermission('purchases:record')];
  const canManage = [guards.authenticate(), guards.requirePermission('suppliers:manage')];

  const posContext = (req: Request): PosContext => {
    const { user, session } = getAuth(req);
    const ctx: PosContext = {
      actor: user,
      session,
      meta: getRequestMeta(req, config.trustCloudflareHeader),
    };
    if (logger !== undefined) ctx.logger = logger;
    return ctx;
  };

  router.get('/purchases/order-suggestions', ...canManage, async (_req, res) => {
    res.json({ groups: await getOrderSuggestions() });
  });
  router.get('/purchases', ...canRecord, async (req, res) => {
    res.json(await listPurchases(parseQuery(req, listPurchasesQuerySchema)));
  });
  router.post('/purchases', ...canRecord, approvalLimiter, async (req, res) => {
    const input = parseBody(req, createPurchaseRequestSchema);
    res.status(201).json({ purchase: await createPurchase(input, posContext(req)) });
  });
  router.post('/purchases/:id/void', ...canRecord, approvalLimiter, async (req, res) => {
    const input = parseBody(req, voidPurchaseRequestSchema);
    res.json({ purchase: await voidPurchase(String(req.params.id), input, posContext(req)) });
  });
  router.get('/supplier-returns', ...canRecord, async (req, res) => {
    res.json(await listSupplierReturns(parseQuery(req, listPurchasesQuerySchema)));
  });
  router.post('/supplier-returns', ...canRecord, async (req, res) => {
    const input = parseBody(req, createSupplierReturnRequestSchema);
    res.status(201).json({ supplierReturn: await createSupplierReturn(input, posContext(req)) });
  });

  return router;
}
