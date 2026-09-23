import { Router, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import { createAuditRouter } from './modules/audit/audit.routes';
import type { AuthConfig } from './modules/auth/auth.config';
import type { AuthGuards } from './modules/auth/auth.middleware';
import { createAuthRouter } from './modules/auth/auth.routes';
import { createUsersRouter } from './modules/users/users.routes';

export interface ApiRouterDeps {
  authConfig: AuthConfig;
  guards: AuthGuards;
  credentialsLimiter: RequestHandler;
  logger?: Logger;
}

/**
 * Rutas de negocio bajo /api/v1. Cada módulo de la Fase 1 (auth, users, catalog, sales,
 * cash, inventory, reports, audit) registra aquí su router.
 */
export function createApiRouter(deps: ApiRouterDeps): Router {
  const { authConfig, guards, credentialsLimiter, logger } = deps;
  const withLogger = <T extends object>(value: T): T & { logger?: Logger } =>
    logger === undefined ? value : { ...value, logger };

  const router = Router();
  router.use(
    '/auth',
    createAuthRouter(withLogger({ config: authConfig, guards, credentialsLimiter })),
  );
  router.use('/users', createUsersRouter(withLogger({ config: authConfig, guards })));
  router.use('/audit-logs', createAuditRouter(guards));
  return router;
}
