import { apiErrorResponseSchema, type ErrorCode } from '@panesypan/shared';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'CONFIG_ERROR';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(
    status: number,
    code: ClientErrorCode,
    message: string,
    options: { requestId?: string | undefined; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = options.requestId;
    this.details = options.details;
  }

  /** Errores de validación por campo (`[{ path, message }]`) → `{ campo: mensaje }`. */
  fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    if (!Array.isArray(this.details)) return result;
    for (const item of this.details) {
      if (item !== null && typeof item === 'object' && 'path' in item && 'message' in item) {
        const { path, message } = item as { path: unknown; message: unknown };
        if (typeof path === 'string' && typeof message === 'string' && !(path in result)) {
          result[path] = message;
        }
      }
    }
    return result;
  }
}

export function errorCodeOf(body: unknown): ErrorCode | null {
  const parsed = apiErrorResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.error.code : null;
}

/** Convierte una respuesta de error de la API en un ApiError con su código y mensaje. */
export function toApiError(status: number, body: unknown, requestId?: string): ApiError {
  const parsed = apiErrorResponseSchema.safeParse(body);
  if (parsed.success) {
    const { code, message, details } = parsed.data.error;
    return new ApiError(status, code, message, {
      requestId: parsed.data.error.requestId ?? requestId,
      details,
    });
  }
  return new ApiError(
    status,
    'INVALID_RESPONSE',
    `El servidor respondió con un error (${String(status)})`,
    {
      requestId,
    },
  );
}

/** Mensaje amigable para mostrar al usuario ante cualquier error. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Ocurrió un error inesperado. Intenta de nuevo.';
}
