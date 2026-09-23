import { z } from 'zod';

/** Respuesta de GET /api/health (no consulta la base de datos). */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.int().nonnegative(),
  version: z.string(),
  commit: z.string().nullable(),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Respuesta de GET /api/health/db (200 si responde, 503 si no). */
export const databaseHealthResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    database: z.literal('up'),
    latencyMs: z.int().nonnegative(),
  }),
  z.object({
    status: z.literal('error'),
    database: z.literal('down'),
  }),
]);

export type DatabaseHealthResponse = z.infer<typeof databaseHealthResponseSchema>;
