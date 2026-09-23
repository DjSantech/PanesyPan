import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { getAppInfo } from './config/app-info';
import type { Env } from './config/env';
import { createCors } from './middlewares/cors';
import { createErrorHandler } from './middlewares/error-handler';
import { notFound } from './middlewares/not-found';
import { originVerify } from './middlewares/origin-verify';
import { createRateLimiter } from './middlewares/rate-limit';
import { rejectUnsafeKeys } from './middlewares/reject-unsafe-keys';
import { createRequestLogger } from './middlewares/request-logger';
import { createHealthRouter } from './modules/health/health.routes';
import { createApiRouter } from './routes';

const JSON_BODY_LIMIT = '100kb';

/** Crea la aplicación Express. No abre puertos ni conexiones: así se puede probar con Supertest. */
export function createApp(env: Env, logger: Logger): Express {
  const app = express();
  const verifyOrigin = env.ORIGIN_VERIFY_SECRET !== undefined;

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
      trustCloudflareHeader: verifyOrigin,
    }),
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(rejectUnsafeKeys);

  app.use('/api/v1', createApiRouter());

  app.use(notFound);
  app.use(createErrorHandler(env.NODE_ENV));

  return app;
}
