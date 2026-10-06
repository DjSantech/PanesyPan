import {
  createCashConceptRequestSchema,
  createStaffMemberRequestSchema,
  hasPermission,
  updateCashConceptRequestSchema,
  updateStaffMemberRequestSchema,
} from '@panesypan/shared';
import { Router, type Request } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { getRequestMeta } from '../../lib/request-meta';
import { parseBody, parseIdParam, parseQuery } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import type { ActorContext } from '../users/users.service';
import {
  createCashConcept,
  createStaffMember,
  listCashConcepts,
  listStaff,
  updateCashConcept,
  updateStaffMember,
} from './cash-config.service';

export interface CashConfigRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  logger?: Logger;
}

const listQuerySchema = z.strictObject({ all: z.enum(['true', 'false']).optional() });

/**
 * /api/v1
 *   GET   /cash-concepts        tipos de movimiento activos (?all=true: también los inactivos, admin)
 *   POST  /cash-concepts        crear tipo (admin)
 *   PATCH /cash-concepts/:id    renombrar, activar o desactivar (admin)
 *   GET   /staff                personal activo (?all=true: todo, admin)
 *   POST  /staff · PATCH /staff/:id   administrar el personal (admin)
 */
export function createCashConfigRouter(deps: CashConfigRouterDeps): Router {
  const { config, guards, logger } = deps;
  const router = Router();
  const canRead = [guards.authenticate(), guards.requirePermission('cash:operate')];
  const canManage = [guards.authenticate(), guards.requirePermission('settings:manage')];

  const actorContext = (req: Request): ActorContext => {
    const ctx: ActorContext = {
      actor: getAuth(req).user,
      meta: getRequestMeta(req, config.trustCloudflareHeader),
    };
    if (logger !== undefined) ctx.logger = logger;
    return ctx;
  };
  /** Los inactivos solo los ve quien puede administrarlos. */
  const activeOnly = (req: Request): boolean =>
    parseQuery(req, listQuerySchema).all !== 'true' ||
    !hasPermission(getAuth(req).user.role, 'settings:manage');

  router.get('/cash-concepts', ...canRead, async (req, res) => {
    res.json({ items: await listCashConcepts({ activeOnly: activeOnly(req) }) });
  });
  router.post('/cash-concepts', ...canManage, async (req, res) => {
    const input = parseBody(req, createCashConceptRequestSchema);
    res.status(201).json({ concept: await createCashConcept(input, actorContext(req)) });
  });
  router.patch('/cash-concepts/:id', ...canManage, async (req, res) => {
    const input = parseBody(req, updateCashConceptRequestSchema);
    res.json({ concept: await updateCashConcept(parseIdParam(req), input, actorContext(req)) });
  });

  router.get('/staff', ...canRead, async (req, res) => {
    res.json({ items: await listStaff({ activeOnly: activeOnly(req) }) });
  });
  router.post('/staff', ...canManage, async (req, res) => {
    const input = parseBody(req, createStaffMemberRequestSchema);
    res.status(201).json({ member: await createStaffMember(input, actorContext(req)) });
  });
  router.patch('/staff/:id', ...canManage, async (req, res) => {
    const input = parseBody(req, updateStaffMemberRequestSchema);
    res.json({ member: await updateStaffMember(parseIdParam(req), input, actorContext(req)) });
  });

  return router;
}
