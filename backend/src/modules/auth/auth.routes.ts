import {
  changePasswordRequestSchema,
  loginRequestSchema,
  setPinRequestSchema,
  unlockRequestSchema,
} from '@panesypan/shared';
import { Router, type RequestHandler, type Response } from 'express';
import type { Logger } from 'pino';
import {
  clearAuthCookies,
  readAccessToken,
  readRefreshToken,
  setAuthCookies,
} from '../../lib/auth-cookies';
import { AppError } from '../../lib/errors';
import { getRequestMeta } from '../../lib/request-meta';
import { verifyAccessToken } from '../../lib/tokens';
import { parseBody } from '../../lib/validate';
import type { AuthConfig } from './auth.config';
import { getAuth, type AuthGuards } from './auth.middleware';
import {
  buildAuthResponse,
  changePassword,
  lockSession,
  login,
  logout,
  logoutAll,
  refresh,
  setPin,
  unlockSession,
  type IssuedAuth,
} from './auth.service';

export interface AuthRouterDeps {
  config: AuthConfig;
  guards: AuthGuards;
  /** Límite estricto para login y PIN (solo cuenta los intentos fallidos). */
  credentialsLimiter: RequestHandler;
  logger?: Logger;
}

/**
 * /api/v1/auth
 *   POST /login · POST /refresh · POST /logout · GET /me · POST /lock · POST /unlock
 *   POST /logout-all · POST /change-password · PUT /pin
 */
export function createAuthRouter(deps: AuthRouterDeps): Router {
  const { config, guards, credentialsLimiter, logger } = deps;
  const serviceDeps = logger === undefined ? { config } : { config, logger };
  const router = Router();

  const sendAuth = (res: Response, issued: IssuedAuth): void => {
    const tokens: Parameters<typeof setAuthCookies>[2] = {
      accessToken: issued.accessToken,
      sessionExpiresAt: issued.sessionExpiresAt,
    };
    if (issued.refreshToken !== undefined) tokens.refreshToken = issued.refreshToken;
    setAuthCookies(res, config.cookies, tokens);
    res.set('Cache-Control', 'no-store').json(issued.response);
  };

  router.post('/login', credentialsLimiter, async (req, res) => {
    const input = parseBody(req, loginRequestSchema);
    sendAuth(
      res,
      await login(input, getRequestMeta(req, config.trustCloudflareHeader), serviceDeps),
    );
  });

  router.post('/refresh', async (req, res) => {
    try {
      const issued = await refresh(
        readRefreshToken(req, config.cookies),
        getRequestMeta(req, config.trustCloudflareHeader),
        serviceDeps,
      );
      sendAuth(res, issued);
    } catch (error) {
      clearAuthCookies(res, config.cookies);
      throw error;
    }
  });

  router.post('/logout', async (req, res) => {
    const accessToken = readAccessToken(req, config.cookies);
    const claims =
      accessToken === undefined
        ? null
        : await verifyAccessToken(accessToken, config.accessTokenSecret);
    const input: { sessionId?: string; refreshToken?: string } = {};
    if (claims !== null) input.sessionId = claims.sessionId;
    const refreshToken = readRefreshToken(req, config.cookies);
    if (refreshToken !== undefined) input.refreshToken = refreshToken;

    await logout(input, getRequestMeta(req, config.trustCloudflareHeader), serviceDeps);
    clearAuthCookies(res, config.cookies);
    res.status(204).end();
  });

  router.get(
    '/me',
    guards.authenticate({ allowLocked: true, allowPasswordChange: true }),
    (req, res) => {
      const auth = getAuth(req);
      res.set('Cache-Control', 'no-store').json(buildAuthResponse(auth.user, auth.session, config));
    },
  );

  router.post(
    '/lock',
    guards.authenticate({ allowLocked: true, allowPasswordChange: true }),
    async (req, res) => {
      await lockSession(getAuth(req));
      res.status(204).end();
    },
  );

  router.post(
    '/unlock',
    credentialsLimiter,
    guards.authenticate({ allowLocked: true, allowPasswordChange: true }),
    async (req, res) => {
      const { pin } = parseBody(req, unlockRequestSchema);
      const result = await unlockSession(
        getAuth(req),
        pin,
        getRequestMeta(req, config.trustCloudflareHeader),
        serviceDeps,
      );
      if (result.ok) {
        sendAuth(res, result.issued);
        return;
      }
      if (result.sessionClosed) {
        clearAuthCookies(res, config.cookies);
        throw new AppError(
          401,
          'UNAUTHORIZED',
          'Demasiados intentos con el PIN. Ingresa de nuevo con tu contraseña.',
        );
      }
      throw new AppError(
        401,
        'INVALID_PIN',
        `PIN incorrecto. Te ${result.remainingAttempts === 1 ? 'queda 1 intento' : `quedan ${String(result.remainingAttempts)} intentos`}.`,
        { remainingAttempts: result.remainingAttempts },
      );
    },
  );

  router.post(
    '/logout-all',
    guards.authenticate({ allowPasswordChange: true }),
    async (req, res) => {
      await logoutAll(getAuth(req), getRequestMeta(req, config.trustCloudflareHeader), serviceDeps);
      clearAuthCookies(res, config.cookies);
      res.status(204).end();
    },
  );

  router.post(
    '/change-password',
    guards.authenticate({ allowPasswordChange: true }),
    async (req, res) => {
      const input = parseBody(req, changePasswordRequestSchema);
      const response = await changePassword(
        getAuth(req),
        input,
        getRequestMeta(req, config.trustCloudflareHeader),
        serviceDeps,
      );
      res.set('Cache-Control', 'no-store').json(response);
    },
  );

  router.put('/pin', guards.authenticate(), async (req, res) => {
    const input = parseBody(req, setPinRequestSchema);
    const response = await setPin(
      getAuth(req),
      input,
      getRequestMeta(req, config.trustCloudflareHeader),
      serviceDeps,
    );
    res.set('Cache-Control', 'no-store').json(response);
  });

  return router;
}
