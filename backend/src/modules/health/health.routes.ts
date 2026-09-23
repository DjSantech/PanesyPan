import { Router } from 'express';
import type { AppInfo } from '../../config/app-info';
import { createHealthController } from './health.controller';

/**
 * GET /api/health     → proceso vivo (para UptimeRobot cada 5 min y el health check de Render).
 * GET /api/health/db  → ping a MongoDB (200 si responde, 503 si no).
 * Se montan antes del rate limit y de la verificación de origen.
 */
export function createHealthRouter(appInfo: AppInfo): Router {
  const controller = createHealthController(appInfo);
  const router = Router();
  router.get('/', controller.health);
  router.get('/db', controller.databaseHealth);
  return router;
}
