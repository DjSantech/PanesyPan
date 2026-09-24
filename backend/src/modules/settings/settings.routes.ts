import { updateBusinessSettingsRequestSchema } from '@panesypan/shared';
import { Router } from 'express';
import type { Logger } from 'pino';
import { getRequestMeta } from '../../lib/request-meta';
import { parseBody } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import { getSettings, updateSettings } from './settings.service';

export interface SettingsRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  logger?: Logger;
}

/**
 * /api/v1/settings
 *   GET   /  cualquier usuario con sesión (el POS necesita las mesas, el tope y el tiquete)
 *   PATCH /  solo el administrador
 */
export function createSettingsRouter(deps: SettingsRouterDeps): Router {
  const { config, guards, logger } = deps;
  const router = Router();

  router.get('/', guards.authenticate(), async (_req, res) => {
    res.json({ settings: await getSettings() });
  });

  router.patch(
    '/',
    guards.authenticate(),
    guards.requirePermission('settings:manage'),
    async (req, res) => {
      const input = parseBody(req, updateBusinessSettingsRequestSchema);
      const ctx = {
        actor: getAuth(req).user,
        meta: getRequestMeta(req, config.trustCloudflareHeader),
        ...(logger === undefined ? {} : { logger }),
      };
      res.json({ settings: await updateSettings(input, ctx) });
    },
  );

  return router;
}
