import { z } from 'zod';
import { ERROR_CODES } from '../constants/error-codes';

/** Forma estándar de todas las respuestas de error de la API. */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
