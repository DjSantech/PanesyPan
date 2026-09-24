import { openCashShiftRequestSchema } from '@panesypan/shared';
import { Router } from 'express';
import type { Logger } from 'pino';
import { getRequestMeta } from '../../lib/request-meta';
import { parseBody } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import { getCurrentShift, openShift } from './cash.service';

export interface CashRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  logger?: Logger;
}

/**
 * /api/v1/cash-shifts
 *   GET  /current  caja abierta de quien consulta (o null) con su resumen
 *   POST /         abrir caja con la base inicial
 */
export function createCashRouter(deps: CashRouterDeps): Router {
  const { config, guards, logger } = deps;
  const router = Router();
  const canOperate = [guards.authenticate(), guards.requirePermission('cash:operate')];

  router.get('/current', ...canOperate, async (req, res) => {
    res.json({ shift: await getCurrentShift(getAuth(req).user.id) });
  });

  router.post('/', ...canOperate, async (req, res) => {
    const input = parseBody(req, openCashShiftRequestSchema);
    const ctx = {
      actor: getAuth(req).user,
      meta: getRequestMeta(req, config.trustCloudflareHeader),
      ...(logger === undefined ? {} : { logger }),
    };
    res.status(201).json({ shift: await openShift(input, ctx) });
  });

  return router;
}
