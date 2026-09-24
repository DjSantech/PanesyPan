import { listElectronicDocumentsQuerySchema } from '@panesypan/shared';
import { Router, type Request } from 'express';
import type { Logger } from 'pino';
import { getRequestMeta } from '../../lib/request-meta';
import { parseIdParam, parseQuery } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import type { ActorContext } from '../users/users.service';
import { getEInvoiceStatus, listDocuments, retryDocument } from './einvoice.service';
import { kickEInvoiceWorker } from './einvoice.worker';

export interface EInvoiceRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  logger?: Logger;
}

/**
 * /api/v1/einvoices  (todo requiere einvoice:manage, o sea, administrador)
 *   GET  /            facturas y notas crédito (?status=&kind=)
 *   GET  /status      proveedor, ambiente y conteo por estado
 *   POST /:id/retry   reenviar un documento rechazado o sin enviar
 */
export function createEInvoiceRouter(deps: EInvoiceRouterDeps): Router {
  const { config, guards, logger } = deps;
  const router = Router();
  router.use(guards.authenticate(), guards.requirePermission('einvoice:manage'));

  const actorContext = (req: Request): ActorContext => {
    const ctx: ActorContext = {
      actor: getAuth(req).user,
      meta: getRequestMeta(req, config.trustCloudflareHeader),
    };
    if (logger !== undefined) ctx.logger = logger;
    return ctx;
  };

  router.get('/', async (req, res) => {
    res.json({ items: await listDocuments(parseQuery(req, listElectronicDocumentsQuerySchema)) });
  });

  router.get('/status', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await getEInvoiceStatus());
  });

  router.post('/:id/retry', async (req, res) => {
    const document = await retryDocument(parseIdParam(req), actorContext(req));
    kickEInvoiceWorker();
    res.json({ document });
  });

  return router;
}
