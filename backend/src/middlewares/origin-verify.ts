import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors';

const ORIGIN_VERIFY_HEADER = 'x-origin-verify';

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Exige el header secreto que agrega Cloudflare (Transform Rule) a cada petición.
 * Así se bloquea el acceso directo a la URL *.onrender.com, que se saltaría el WAF
 * y permitiría falsificar la IP del cliente.
 */
export function originVerify(secret: string): RequestHandler {
  const expected = sha256(secret);
  return (req, _res, next) => {
    const provided = req.get(ORIGIN_VERIFY_HEADER);
    if (provided !== undefined && timingSafeEqual(sha256(provided), expected)) {
      next();
      return;
    }
    next(new AppError(403, 'FORBIDDEN', 'Acceso no permitido'));
  };
}
