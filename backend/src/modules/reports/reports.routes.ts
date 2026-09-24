import { EXPORT_KINDS, exportQuerySchema, type ExportKind } from '@panesypan/shared';
import { Router } from 'express';
import type { Logger } from 'pino';
import { AppError } from '../../lib/errors';
import { getRequestMeta } from '../../lib/request-meta';
import { parseQuery } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import type { ActorContext } from '../users/users.service';
import { getDashboardSummary } from './dashboard.service';
import { exportReport } from './export.service';

export interface ReportsRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  logger?: Logger;
}

const isExportKind = (value: string): value is ExportKind =>
  (EXPORT_KINDS as readonly string[]).includes(value);

/**
 * /api/v1/reports  (todo requiere reports:read, o sea, administrador)
 *   GET /dashboard                    resumen del día en curso
 *   GET /export/:kind?from=&to=       CSV de ventas, cajas o inventario (kind: sales|cash|inventory)
 */
export function createReportsRouter(deps: ReportsRouterDeps): Router {
  const { config, guards, logger } = deps;
  const router = Router();
  const canRead = [guards.authenticate(), guards.requirePermission('reports:read')];

  router.get('/dashboard', ...canRead, async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getDashboardSummary());
  });

  router.get('/export/:kind', ...canRead, async (req, res) => {
    const { kind } = req.params;
    if (typeof kind !== 'string' || !isExportKind(kind)) {
      throw new AppError(404, 'NOT_FOUND', 'Reporte no encontrado');
    }
    const ctx: ActorContext = {
      actor: getAuth(req).user,
      meta: getRequestMeta(req, config.trustCloudflareHeader),
    };
    if (logger !== undefined) ctx.logger = logger;

    const file = await exportReport(kind, parseQuery(req, exportQuerySchema), ctx);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(file.content);
  });

  return router;
}
