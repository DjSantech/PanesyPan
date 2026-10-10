import { createProfileRequestSchema, updateProfileRequestSchema } from '@panesypan/shared';
import { Router, type Request } from 'express';
import type { Logger } from 'pino';
import { getRequestMeta } from '../../lib/request-meta';
import { parseBody, parseIdParam } from '../../lib/validate';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import type { ActorContext } from '../users/users.service';
import { createProfile, listProfiles, updateProfile } from './profiles.service';

export interface ProfilesRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  logger?: Logger;
}

/**
 * /api/v1/profiles · perfiles de permisos (permiso users:manage)
 *   GET / · POST / · PATCH /:id
 */
export function createProfilesRouter(deps: ProfilesRouterDeps): Router {
  const { config, guards, logger } = deps;
  const router = Router();
  router.use(guards.authenticate(), guards.requirePermission('users:manage'));

  const actorContext = (req: Request): ActorContext => {
    const ctx: ActorContext = {
      actor: getAuth(req).user,
      meta: getRequestMeta(req, config.trustCloudflareHeader),
    };
    if (logger !== undefined) ctx.logger = logger;
    return ctx;
  };

  router.get('/', async (_req, res) => {
    res.json({ items: await listProfiles() });
  });

  router.post('/', async (req, res) => {
    const input = parseBody(req, createProfileRequestSchema);
    res.status(201).json({ profile: await createProfile(input, actorContext(req)) });
  });

  router.patch('/:id', async (req, res) => {
    const input = parseBody(req, updateProfileRequestSchema);
    res.json({ profile: await updateProfile(parseIdParam(req), input, actorContext(req)) });
  });

  return router;
}
