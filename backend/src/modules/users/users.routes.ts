import {
  createUserRequestSchema,
  listUsersQuerySchema,
  setUserProfileRequestSchema,
  setUserStatusRequestSchema,
  updateUserRequestSchema,
} from '@panesypan/shared';
import { Router, type Request } from 'express';
import type { Logger } from 'pino';
import { getRequestMeta } from '../../lib/request-meta';
import { parseBody, parseIdParam, parseQuery } from '../../lib/validate';
import { setUserProfile } from '../profiles/profiles.service';
import type { AuthConfig } from '../auth/auth.config';
import { getAuth, type AuthGuards } from '../auth/auth.middleware';
import {
  createUser,
  getUser,
  listUsers,
  resetUserPassword,
  resetUserPin,
  setUserStatus,
  unlockUser,
  updateUser,
  type ActorContext,
} from './users.service';

export interface UsersRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  logger?: Logger;
}

/**
 * /api/v1/users · solo administradores (permiso users:manage)
 *   GET / · POST / · GET /:id · PATCH /:id · PATCH /:id/status
 *   PATCH /:id/profile · POST /:id/reset-password · POST /:id/reset-pin · POST /:id/unlock
 */
export function createUsersRouter(deps: UsersRouterDeps): Router {
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

  router.get('/', async (req, res) => {
    const query = parseQuery(req, listUsersQuerySchema);
    res.json({ items: await listUsers(query) });
  });

  router.post('/', async (req, res) => {
    const input = parseBody(req, createUserRequestSchema);
    res
      .status(201)
      .set('Cache-Control', 'no-store')
      .json(await createUser(input, actorContext(req)));
  });

  router.get('/:id', async (req, res) => {
    res.json({ user: await getUser(parseIdParam(req)) });
  });

  router.patch('/:id', async (req, res) => {
    const input = parseBody(req, updateUserRequestSchema);
    res.json({ user: await updateUser(parseIdParam(req), input, actorContext(req)) });
  });

  router.patch('/:id/status', async (req, res) => {
    const { isActive } = parseBody(req, setUserStatusRequestSchema);
    res.json({ user: await setUserStatus(parseIdParam(req), isActive, actorContext(req)) });
  });

  router.patch('/:id/profile', async (req, res) => {
    const { profileId } = parseBody(req, setUserProfileRequestSchema);
    res.json({ user: await setUserProfile(parseIdParam(req), profileId, actorContext(req)) });
  });

  router.post('/:id/reset-password', async (req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json(await resetUserPassword(parseIdParam(req), actorContext(req)));
  });

  router.post('/:id/reset-pin', async (req, res) => {
    res.json({ user: await resetUserPin(parseIdParam(req), actorContext(req)) });
  });

  router.post('/:id/unlock', async (req, res) => {
    res.json({ user: await unlockUser(parseIdParam(req), actorContext(req)) });
  });

  return router;
}
