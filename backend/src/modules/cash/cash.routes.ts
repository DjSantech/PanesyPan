import {
  closeCashShiftRequestSchema,
  confirmCashShiftRequestSchema,
  createCashMovementRequestSchema,
  listCashShiftsQuerySchema,
  openCashShiftRequestSchema,
} from '@panesypan/shared';
import { Router, type Request, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import { getRequestMeta } from '../../lib/request-meta';
import { parseBody, parseIdParam, parseQuery } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import type { PosContext } from '../sales/approval.service';
import { getSettings } from '../settings/settings.service';
import {
  closeShift,
  confirmShift,
  createMovement,
  getCurrentShift,
  getShiftDetail,
  listMovements,
  listShifts,
  openShift,
  suggestedOpeningAmount,
} from './cash.service';
import { notifyShiftClosed } from './close-alert';

export interface CashRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  /** Límite de intentos para las peticiones que traen el PIN de un administrador. */
  approvalLimiter: RequestHandler;
  logger?: Logger;
}

/**
 * /api/v1/cash-shifts
 *   GET  /current             caja abierta de quien consulta (o null) con su resumen
 *   POST /                    abrir caja con la base inicial
 *   GET  /current/movements   egresos y retiros de la caja abierta
 *   POST /current/movements   registrar un egreso o retiro (retiros y egresos altos: PIN de admin)
 *   POST /current/close       cerrar la caja con el arqueo por denominaciones
 *   GET  /?from=&to=&userId=  historial de cajas (administrador)
 *   GET  /:id                 resumen detallado de una caja (administrador)
 *   POST /:id/confirm         el administrador confirma el cierre
 */
export function createCashRouter(deps: CashRouterDeps): Router {
  const { config, guards, approvalLimiter, logger } = deps;
  const router = Router();
  const canOperate = [guards.authenticate(), guards.requirePermission('cash:operate')];
  const canReview = [guards.authenticate(), guards.requirePermission('cash:review')];

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

  router.get('/current', ...canOperate, async (req, res) => {
    const [shift, suggested] = await Promise.all([
      getCurrentShift(getAuth(req).user.id),
      suggestedOpeningAmount(),
    ]);
    res.json({ shift, suggestedOpeningAmount: suggested });
  });

  router.post('/', ...canOperate, async (req, res) => {
    const input = parseBody(req, openCashShiftRequestSchema);
    res.status(201).json({ shift: await openShift(input, posContext(req)) });
  });

  router.get('/current/movements', ...canOperate, async (req, res) => {
    res.json({ items: await listMovements(getAuth(req).user.id) });
  });

  router.post('/current/movements', ...canOperate, approvalLimiter, async (req, res) => {
    const input = parseBody(req, createCashMovementRequestSchema);
    res.status(201).json({ movement: await createMovement(input, posContext(req)) });
  });

  router.post('/current/close', ...canOperate, async (req, res) => {
    const input = parseBody(req, closeCashShiftRequestSchema);
    const shift = await closeShift(input, posContext(req));
    res.json({ shift });
    // El aviso al dueño sale después de responder: la cajera no espera el correo.
    void Promise.all([getShiftDetail(shift.id), getSettings()])
      .then(([detail, settings]) => {
        notifyShiftClosed(detail, settings, logger);
      })
      .catch((error: unknown) => {
        logger?.warn({ err: error }, 'No se pudo preparar el aviso de cierre de caja');
      });
  });

  router.get('/', ...canReview, async (req, res) => {
    res.json({ items: await listShifts(parseQuery(req, listCashShiftsQuerySchema)) });
  });

  router.get('/:id', ...canReview, async (req, res) => {
    res.json(await getShiftDetail(parseIdParam(req)));
  });

  router.post('/:id/confirm', ...canReview, async (req, res) => {
    const input = parseBody(req, confirmCashShiftRequestSchema);
    res.json({ shift: await confirmShift(parseIdParam(req), input, posContext(req)) });
  });

  return router;
}
