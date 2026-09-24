import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { getAppInfo } from './config/app-info';
import type { Env } from './config/env';
import { createCors } from './middlewares/cors';
import { createErrorHandler } from './middlewares/error-handler';
import { notFound } from './middlewares/not-found';
import { createOriginCheck } from './middlewares/origin-check';
import { originVerify } from './middlewares/origin-verify';
import { createRateLimiter } from './middlewares/rate-limit';
import { rejectUnsafeKeys } from './middlewares/reject-unsafe-keys';
import { createRequestLogger } from './middlewares/request-logger';
import { authConfigFromEnv } from './modules/auth/auth.config';
import { createAuthGuards } from './modules/auth/auth.middleware';
import { createHealthRouter } from './modules/health/health.routes';
import { createApiRouter } from './routes';

const JSON_BODY_LIMIT = '100kb';
const CREDENTIALS_WINDOW_MS = 15 * 60_000;

const hasApproverPin = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && 'approverPin' in body;

/** Crea la aplicación Express. No abre puertos ni conexiones: así se puede probar con Supertest. */
export function createApp(env: Env, logger: Logger): Express {
  const app = express();
  const authConfig = authConfigFromEnv(env);

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(createRequestLogger(logger));
  app.use(helmet());
  app.use(createCors(env.CORS_ORIGINS));

  // Health checks: sin rate limit y sin verificación de origen (Render los consulta directamente).
  app.use('/api/health', createHealthRouter(getAppInfo(env)));

  if (env.ORIGIN_VERIFY_SECRET !== undefined) {
    app.use(originVerify(env.ORIGIN_VERIFY_SECRET));
  }
  app.use(
    createRateLimiter({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      trustCloudflareHeader: authConfig.trustCloudflareHeader,
    }),
  );
  app.use(createOriginCheck(env.CORS_ORIGINS));
  app.use(cookieParser());
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(rejectUnsafeKeys);

  app.use(
    '/api/v1',
    createApiRouter({
      authConfig,
      guards: createAuthGuards(authConfig),
      credentialsLimiter: createRateLimiter({
        windowMs: CREDENTIALS_WINDOW_MS,
        limit: env.AUTH_RATE_LIMIT_MAX,
        trustCloudflareHeader: authConfig.trustCloudflareHeader,
        onlyCountFailures: true,
      }),
      // Solo cuentan los PIN de administrador equivocados (cada sesión además tiene su tope).
      approvalLimiter: createRateLimiter({
        windowMs: CREDENTIALS_WINDOW_MS,
        limit: env.AUTH_RATE_LIMIT_MAX,
        trustCloudflareHeader: authConfig.trustCloudflareHeader,
        onlyCountFailures: true,
        skip: (req) => !hasApproverPin(req.body),
      }),
      logger,
    }),
  );

  app.use(notFound);
  app.use(createErrorHandler(env.NODE_ENV));

  return app;
}
