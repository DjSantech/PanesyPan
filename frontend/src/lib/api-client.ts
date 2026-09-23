import { apiErrorResponseSchema, type ErrorCode } from '@panesypan/shared';
import type { z } from 'zod';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE' | 'CONFIG_ERROR';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly requestId: string | undefined;

  constructor(status: number, code: ClientErrorCode, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

/** URL base de la API (VITE_API_URL) sin barra final. */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL;
  if (raw === undefined || raw.trim() === '') {
    throw new ApiError(
      0,
      'CONFIG_ERROR',
      'Falta configurar VITE_API_URL (ver frontend/.env.example)',
    );
  }
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    throw new ApiError(0, 'CONFIG_ERROR', 'VITE_API_URL no es una URL válida');
  }
}

export interface RawApiResponse {
  status: number;
  body: unknown;
  requestId: string | undefined;
}

/** Petición a la API con cookies incluidas. No lanza error por códigos HTTP, solo por red. */
export async function apiRequest(path: string, init: RequestInit = {}): Promise<RawApiResponse> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor');
  }

  const body: unknown = await response.json().catch(() => null);
  return {
    status: response.status,
    body,
    requestId: response.headers.get('X-Request-Id') ?? undefined,
  };
}

/** Convierte una respuesta de error de la API en un ApiError con su código y mensaje. */
export function toApiError(status: number, body: unknown, requestId?: string): ApiError {
  const parsed = apiErrorResponseSchema.safeParse(body);
  if (parsed.success) {
    const { code, message } = parsed.data.error;
    return new ApiError(status, code, message, parsed.data.error.requestId ?? requestId);
  }
  return new ApiError(
    status,
    'INVALID_RESPONSE',
    `El servidor respondió con un error (${String(status)})`,
    requestId,
  );
}

/** GET tipado: valida la respuesta con el esquema Zod compartido. */
export async function apiGet<T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const { status, body, requestId } = await apiRequest(path, { method: 'GET', signal });
  if (status < 200 || status >= 300) {
    throw toApiError(status, body, requestId);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(status, 'INVALID_RESPONSE', 'Respuesta inesperada del servidor', requestId);
  }
  return parsed.data;
}
