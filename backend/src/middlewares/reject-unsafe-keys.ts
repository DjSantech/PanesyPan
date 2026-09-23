import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 32;

/**
 * Busca claves peligrosas en un JSON: operadores de MongoDB ($ne, $where…), rutas con punto
 * y claves que permiten contaminar prototipos. Devuelve la primera encontrada.
 */
export function findUnsafeKey(value: unknown, depth = 0): string | null {
  if (depth > MAX_DEPTH) return '(profundidad máxima superada)';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUnsafeKey(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (key.startsWith('$') || key.includes('.') || FORBIDDEN_KEYS.has(key)) return key;
      const found = findUnsafeKey(nested, depth + 1);
      if (found !== null) return found;
    }
  }
  return null;
}

/**
 * Rechaza cuerpos JSON con claves peligrosas (defensa contra inyección NoSQL).
 * Nota: `express-mongo-sanitize` no es compatible con Express 5 (req.query es de solo lectura).
 * Los query params no necesitan esto: Express 5 usa el parser "simple", que no crea objetos
 * anidados, y además cada ruta los valida con Zod.
 */
export const rejectUnsafeKeys: RequestHandler = (req, _res, next) => {
  const unsafeKey = findUnsafeKey(req.body);
  if (unsafeKey !== null) {
    next(new AppError(400, 'INVALID_INPUT', 'La solicitud contiene campos no permitidos'));
    return;
  }
  next();
};
