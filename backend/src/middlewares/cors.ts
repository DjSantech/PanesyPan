import cors from 'cors';
import type { RequestHandler } from 'express';

/**
 * CORS estricto: solo los orígenes configurados pueden leer respuestas y enviar cookies.
 * Las peticiones sin Origin (UptimeRobot, curl, servidor a servidor) no llevan headers CORS.
 */
export function createCors(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return cors({
    origin: (origin, callback) => {
      callback(null, origin !== undefined && allowed.has(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
    maxAge: 600,
  });
}
