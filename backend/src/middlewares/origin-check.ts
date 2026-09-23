import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { UNSAFE_METHODS } from '../lib/http';

/**
 * Segunda capa contra CSRF: las peticiones que modifican datos solo se aceptan si vienen de un
 * origen permitido. Los navegadores siempre envían Origin en estas peticiones; los clientes sin
 * navegador (curl, pruebas) no lo envían y siguen necesitando el token CSRF para rutas con sesión.
 */
export function createOriginCheck(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.get('origin');
    const crossSite = req.get('sec-fetch-site') === 'cross-site';
    if ((origin !== undefined && !allowed.has(origin)) || (origin === undefined && crossSite)) {
      next(new AppError(403, 'FORBIDDEN', 'Origen no permitido'));
      return;
    }
    next();
  };
}
