import { listAuditLogsQuerySchema } from '@panesypan/shared';
import { Router } from 'express';
import { parseQuery } from '../../lib/validate';
import type { AuthGuards } from '../auth/auth.middleware';
import { listAuditLogs } from './audit.service';

/** GET /api/v1/audit-logs · solo administradores (permiso audit:read). */
export function createAuditRouter(guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.authenticate(), guards.requirePermission('audit:read'));

  router.get('/', async (req, res) => {
    const query = parseQuery(req, listAuditLogsQuerySchema);
    res.json(await listAuditLogs(query));
  });

  return router;
}
