import {
  addTabLineRequestSchema,
  closeSaleRequestSchema,
  counterCheckoutRequestSchema,
  listSalesQuerySchema,
  moveTabRequestSchema,
  openTabRequestSchema,
  tabCheckoutRequestSchema,
  updateTabLineRequestSchema,
} from '@panesypan/shared';
import { Router, type Request, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import { getRequestMeta } from '../../lib/request-meta';
import { parseBody, parseIdParam, parseQuery } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import type { PosContext } from './approval.service';
import { checkoutCounter, checkoutTab, getSale, listSales, voidSale } from './sales.service';
import {
  addTabLine,
  cancelTab,
  listOpenTabs,
  moveTab,
  openTab,
  removeTabLine,
  updateTabLine,
} from './tabs.service';

export interface SalesRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  /** Límite de intentos para las peticiones que traen el PIN de un administrador. */
  approvalLimiter: RequestHandler;
  logger?: Logger;
}

/**
 * /api/v1
 *   Mostrador: POST /sales/checkout
 *   Ventas:    GET /sales · GET /sales/:id · POST /sales/:id/void
 *   Mesas:     GET /tabs · POST /tabs · PATCH /tabs/:id (cambiar de mesa)
 *              POST /tabs/:id/lines · PATCH|DELETE /tabs/:id/lines/:lineId
 *              POST /tabs/:id/checkout · POST /tabs/:id/cancel
 */
export function createSalesRouter(deps: SalesRouterDeps): Router {
  const { config, guards, approvalLimiter, logger } = deps;
  const router = Router();
  const canSell = [guards.authenticate(), guards.requirePermission('pos:sell')];
  const withApproval = [...canSell, approvalLimiter];

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

  // ── Ventas ──
  router.post('/sales/checkout', ...withApproval, async (req, res) => {
    const input = parseBody(req, counterCheckoutRequestSchema);
    const { sale, created } = await checkoutCounter(input, posContext(req));
    res.status(created ? 201 : 200).json({ sale });
  });
  router.get('/sales', ...canSell, async (req, res) => {
    const query = parseQuery(req, listSalesQuerySchema);
    res.json({ items: await listSales(query, posContext(req)) });
  });
  router.get('/sales/:id', ...canSell, async (req, res) => {
    res.json({ sale: await getSale(parseIdParam(req), posContext(req)) });
  });
  router.post('/sales/:id/void', ...withApproval, async (req, res) => {
    const input = parseBody(req, closeSaleRequestSchema);
    res.json({ sale: await voidSale(parseIdParam(req), input, posContext(req)) });
  });

  // ── Mesas ──
  router.get('/tabs', ...canSell, async (_req, res) => {
    res.json({ items: await listOpenTabs() });
  });
  router.post('/tabs', ...canSell, async (req, res) => {
    const { tableNumber } = parseBody(req, openTabRequestSchema);
    res.status(201).json({ sale: await openTab(tableNumber, posContext(req)) });
  });
  router.patch('/tabs/:id', ...canSell, async (req, res) => {
    const { tableNumber } = parseBody(req, moveTabRequestSchema);
    res.json({ sale: await moveTab(parseIdParam(req), tableNumber) });
  });
  router.post('/tabs/:id/lines', ...canSell, async (req, res) => {
    const input = parseBody(req, addTabLineRequestSchema);
    res.json({ sale: await addTabLine(parseIdParam(req), input) });
  });
  router.patch('/tabs/:id/lines/:lineId', ...canSell, async (req, res) => {
    const { quantity } = parseBody(req, updateTabLineRequestSchema);
    res.json({
      sale: await updateTabLine(
        parseIdParam(req),
        parseIdParam(req, 'lineId'),
        quantity,
        posContext(req),
      ),
    });
  });
  router.delete('/tabs/:id/lines/:lineId', ...canSell, async (req, res) => {
    res.json({
      sale: await removeTabLine(parseIdParam(req), parseIdParam(req, 'lineId'), posContext(req)),
    });
  });
  router.post('/tabs/:id/checkout', ...withApproval, async (req, res) => {
    const input = parseBody(req, tabCheckoutRequestSchema);
    res.json({ sale: await checkoutTab(parseIdParam(req), input, posContext(req)) });
  });
  router.post('/tabs/:id/cancel', ...withApproval, async (req, res) => {
    const input = parseBody(req, closeSaleRequestSchema);
    res.json({ sale: await cancelTab(parseIdParam(req), input, posContext(req)) });
  });

  return router;
}
