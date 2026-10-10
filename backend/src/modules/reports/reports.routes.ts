import {
  businessReportQuerySchema,
  EXPORT_KINDS,
  exportQuerySchema,
  type ExportKind,
} from '@panesypan/shared';
import { Router, type Request, type Response } from 'express';
import type { Logger } from 'pino';
import { AppError } from '../../lib/errors';
import { getRequestMeta } from '../../lib/request-meta';
import { parseIdParam, parseQuery } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import type { ActorContext } from '../users/users.service';
import { getBusinessReport } from './business-report.service';
import { getDashboardSummary } from './dashboard.service';
import { exportReport, exportShift, type ExportFile } from './export.service';
import { getPerformanceReport } from './performance.service';

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
 *   GET /business?from=&to=          reporte del negocio en un rango (utilidad, gastos, compras…)
 *   GET /performance?from=&to=       desempeño por caja y por día
 *   GET /export/:kind?from=&to=       CSV de un reporte (kind: uno de EXPORT_KINDS)
 *   GET /cash-shifts/:id/export       CSV con el detalle completo de una caja
 */
export function createReportsRouter(deps: ReportsRouterDeps): Router {
  const { config, guards, logger } = deps;
  const router = Router();
  const canRead = [guards.authenticate(), guards.requirePermission('reports:read')];

  router.get('/dashboard', ...canRead, async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getDashboardSummary());
  });

  router.get('/business', ...canRead, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getBusinessReport(parseQuery(req, businessReportQuerySchema)));
  });

  router.get('/performance', ...canRead, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await getPerformanceReport(parseQuery(req, businessReportQuerySchema)));
  });

  const actorContext = (req: Request): ActorContext => {
    const ctx: ActorContext = {
      actor: getAuth(req).user,
      meta: getRequestMeta(req, config.trustCloudflareHeader),
    };
    if (logger !== undefined) ctx.logger = logger;
    return ctx;
  };

  const sendCsv = (res: Response, file: ExportFile): void => {
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(file.content);
  };

  router.get('/cash-shifts/:id/export', ...canRead, async (req, res) => {
    sendCsv(res, await exportShift(parseIdParam(req), actorContext(req)));
  });

  router.get('/export/:kind', ...canRead, async (req, res) => {
    const { kind } = req.params;
    if (typeof kind !== 'string' || !isExportKind(kind)) {
      throw new AppError(404, 'NOT_FOUND', 'Reporte no encontrado');
    }
    sendCsv(res, await exportReport(kind, parseQuery(req, exportQuerySchema), actorContext(req)));
  });

  return router;
}
