import type { RequestHandler } from 'express';
import type { AppInfo } from '../../config/app-info';
import { getDatabaseHealth, getHealth } from './health.service';

export function createHealthController(appInfo: AppInfo): {
  health: RequestHandler;
  databaseHealth: RequestHandler;
} {
  return {
    health: (_req, res) => {
      res.set('Cache-Control', 'no-store').json(getHealth(appInfo));
    },
    databaseHealth: async (_req, res) => {
      const result = await getDatabaseHealth();
      res
        .status(result.status === 'ok' ? 200 : 503)
        .set('Cache-Control', 'no-store')
        .json(result);
    },
  };
}
