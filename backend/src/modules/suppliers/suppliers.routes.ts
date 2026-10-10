import {
  createSupplierRequestSchema,
  listSuppliersQuerySchema,
  updateSupplierRequestSchema,
} from '@panesypan/shared';
import { Router, type Request } from 'express';
import type { Logger } from 'pino';
import { getRequestMeta } from '../../lib/request-meta';
import { parseBody, parseIdParam, parseQuery } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import type { ActorContext } from '../users/users.service';
import { createSupplier, listSuppliers, updateSupplier } from './suppliers.service';

export interface SuppliersRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  logger?: Logger;
}

/**
 * /api/v1/suppliers
 *   GET   /       lista (quien opera la caja la usa para elegir a quién le paga)
 *   POST  /       crear un proveedor            (administrador)
 *   PATCH /:id    editar o archivar             (administrador)
 */
export function createSuppliersRouter(deps: SuppliersRouterDeps): Router {
  const { config, guards, logger } = deps;
  const router = Router();
  const canRead = [guards.authenticate(), guards.requirePermission('cash:operate')];
  const canManage = [guards.authenticate(), guards.requirePermission('suppliers:manage')];

  const actorContext = (req: Request): ActorContext => {
    const ctx: ActorContext = {
      actor: getAuth(req).user,
      meta: getRequestMeta(req, config.trustCloudflareHeader),
    };
    if (logger !== undefined) ctx.logger = logger;
    return ctx;
  };

  router.get('/', ...canRead, async (req, res) => {
    res.json({ items: await listSuppliers(parseQuery(req, listSuppliersQuerySchema)) });
  });
  router.post('/', ...canManage, async (req, res) => {
    const input = parseBody(req, createSupplierRequestSchema);
    res.status(201).json({ supplier: await createSupplier(input, actorContext(req)) });
  });
  router.patch('/:id', ...canManage, async (req, res) => {
    const input = parseBody(req, updateSupplierRequestSchema);
    res.json({ supplier: await updateSupplier(parseIdParam(req), input, actorContext(req)) });
  });

  return router;
}
