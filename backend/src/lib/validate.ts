import type { Request } from 'express';
import { isValidObjectId } from 'mongoose';
import type { z } from 'zod';
import { AppError } from './errors';

/** Valida el cuerpo con un esquema Zod compartido. Los errores los traduce el manejador central. */
export function parseBody<T>(req: Request, schema: z.ZodType<T>): T {
  return schema.parse(req.body ?? {});
}

/** Valida los query params (en Express 5 req.query es de solo lectura: se valida y se usa el resultado). */
export function parseQuery<T>(req: Request, schema: z.ZodType<T>): T {
  return schema.parse(req.query);
}

/** Valida un parámetro de ruta con formato ObjectId; si no lo es, responde 404 (no revela nada). */
export function parseIdParam(req: Request, name = 'id'): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !isValidObjectId(value) || !/^[a-f\d]{24}$/i.test(value)) {
    throw new AppError(404, 'NOT_FOUND', 'Recurso no encontrado');
  }
  return value;
}
