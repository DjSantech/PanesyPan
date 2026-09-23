import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { getClientIp } from '../lib/client-ip';
import { AppError } from '../lib/errors';

export interface RateLimiterOptions {
  windowMs: number;
  limit: number;
  trustCloudflareHeader: boolean;
  /** Solo cuenta respuestas con error (útil para login: los ingresos correctos no gastan cupo). */
  onlyCountFailures?: boolean;
}

/**
 * Límite de peticiones por IP. Los health checks se montan antes de este middleware,
 * por eso nunca quedan limitados.
 * El límite general es amplio porque todas las tablets del local comparten la misma IP pública.
 */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: options.onlyCountFailures ?? false,
    keyGenerator: (req) => ipKeyGenerator(getClientIp(req, options.trustCloudflareHeader)),
    handler: (_req, _res, next) => {
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          'Demasiadas solicitudes. Intenta de nuevo en un momento.',
        ),
      );
    },
  });
}
