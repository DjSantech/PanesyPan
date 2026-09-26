import {
  createWebOrderRequestSchema,
  listWebOrdersQuerySchema,
  updateWebOrderStatusRequestSchema,
} from '@panesypan/shared';
import { Router, type Request } from 'express';
import type { Logger } from 'pino';
import { getRequestMeta } from '../../lib/request-meta';
import { parseBody, parseIdParam, parseQuery } from '../../lib/validate';
import { createRateLimiter } from '../../middlewares/rate-limit';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import { notifyWebOrdersChanged } from '../realtime/realtime';
import type { ActorContext } from '../users/users.service';
import {
  createWebOrder,
  listWebOrders,
  toPublicWebOrder,
  updateWebOrderStatus,
} from './web-orders.service';

/** Pedidos por IP: 5 cada 10 minutos (además del límite general). */
export const WEB_ORDER_RATE_LIMIT = { windowMs: 10 * 60_000, limit: 5 } as const;

export interface WebOrdersRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  logger?: Logger;
}

/**
 * /api/v1/public (sin sesión)
 *   POST /pedidos   pedido de la web: precios recalculados con la BD, idempotente por clientRequestId
 * Los logs no guardan datos del cliente: solo el número de pedido.
 */
export function createPublicWebOrdersRouter(deps: WebOrdersRouterDeps): Router {
  const { config, logger } = deps;
  const router = Router();
  const limiter = createRateLimiter({
    ...WEB_ORDER_RATE_LIMIT,
    trustCloudflareHeader: config.trustCloudflareHeader,
  });

  router.post('/pedidos', limiter, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const input = parseBody(req, createWebOrderRequestSchema);
    const { order, created } = await createWebOrder(input);
    if (created) {
      logger?.info({ webOrderNumber: order.number }, 'Pedido web recibido');
      notifyWebOrdersChanged();
    }
    res.status(created ? 201 : 200).json({ order: toPublicWebOrder(order) });
  });

  return router;
}

/**
 * /api/v1/web-orders
 *   GET /                 pedidos de hoy y pendientes (?status=)
 *   PATCH /:id/status     pasa al siguiente estado
 */
export function createWebOrdersRouter(deps: WebOrdersRouterDeps): Router {
  const { config, guards, logger } = deps;
  const router = Router();
  const canRead = [guards.authenticate(), guards.requirePermission('web-orders:read')];
  const canManage = [guards.authenticate(), guards.requirePermission('web-orders:manage')];

  const actorContext = (req: Request): ActorContext => {
    const ctx: ActorContext = {
      actor: getAuth(req).user,
      meta: getRequestMeta(req, config.trustCloudflareHeader),
    };
    if (logger !== undefined) ctx.logger = logger;
    return ctx;
  };

  router.get('/', ...canRead, async (req, res) => {
    const query = parseQuery(req, listWebOrdersQuerySchema);
    res.json({ orders: await listWebOrders(query) });
  });

  router.patch('/:id/status', ...canManage, async (req, res) => {
    const id = parseIdParam(req);
    const { status } = parseBody(req, updateWebOrderStatusRequestSchema);
    const order = await updateWebOrderStatus(id, status, actorContext(req));
    notifyWebOrdersChanged();
    res.json({ order });
  });

  return router;
}
