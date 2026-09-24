import { authSessionResponseSchema, type AuthSessionResponse } from '@panesypan/shared';
import type { z } from 'zod';
import { useSessionStore } from '@/stores/session.store';
import { ApiError, errorCodeOf, toApiError } from './api-errors';
import { queryClient, SESSION_QUERY_KEY } from './query-client';

export { ApiError } from './api-errors';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  /** Archivo que viaja tal cual (p. ej. una imagen), con su propio Content-Type. */
  rawBody?: Blob;
  signal?: AbortSignal | undefined;
  /** No intentar renovar la sesión ante un 401 (login, refresh, logout). */
  skipRefresh?: boolean;
}

export interface RawApiResponse {
  status: number;
  body: unknown;
  requestId: string | undefined;
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

async function send(path: string, options: RequestOptions): Promise<RawApiResponse> {
  const method = options.method ?? 'GET';
  const headers = new Headers({ Accept: 'application/json' });
  if (options.rawBody !== undefined) headers.set('Content-Type', options.rawBody.type);
  else if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const csrfToken = useSessionStore.getState().csrfToken;
  if (method !== 'GET' && csrfToken !== null) headers.set('X-CSRF-Token', csrfToken);

  let response: Response;
  try {
    const init: RequestInit = { method, headers, credentials: 'include' };
    if (options.rawBody !== undefined) init.body = options.rawBody;
    else if (options.body !== undefined) init.body = JSON.stringify(options.body);
    if (options.signal !== undefined) init.signal = options.signal;
    response = await fetch(`${getApiBaseUrl()}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'No se pudo conectar con el servidor. Revisa la conexión a internet.',
    );
  }

  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  return {
    status: response.status,
    body,
    requestId: response.headers.get('X-Request-Id') ?? undefined,
  };
}

/** Guarda la sesión en memoria (token CSRF, bloqueo) y en la caché de consultas. */
export function applySession(auth: AuthSessionResponse): void {
  useSessionStore.getState().applyAuth(auth);
  queryClient.setQueryData(SESSION_QUERY_KEY, auth);
}

/** Olvida la sesión local (la del servidor ya terminó o se cerró). */
export function clearSession(): void {
  useSessionStore.getState().reset();
  queryClient.setQueryData(SESSION_QUERY_KEY, null);
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Renueva la sesión con el token de refresco (cookie). Si varias peticiones reciben 401 a la vez,
 * todas esperan un único refresco: dos refrescos simultáneos se tomarían como un robo de sesión.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await send('/api/v1/auth/refresh', { method: 'POST', skipRefresh: true });
      const parsed = authSessionResponseSchema.safeParse(response.body);
      if (response.status === 200 && parsed.success) {
        applySession(parsed.data);
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Petición a la API con cookies, token CSRF y renovación automática de la sesión.
 * No lanza errores por códigos HTTP: devuelve la respuesta cruda.
 */
export async function apiRequest(
  path: string,
  options: RequestOptions = {},
): Promise<RawApiResponse> {
  let response = await send(path, options);

  if (
    response.status === 401 &&
    errorCodeOf(response.body) === 'UNAUTHORIZED' &&
    options.skipRefresh !== true
  ) {
    if (await refreshSession()) {
      response = await send(path, options);
    }
    if (response.status === 401 && errorCodeOf(response.body) === 'UNAUTHORIZED') {
      clearSession();
    }
  }

  if (response.status === 423 && errorCodeOf(response.body) === 'SESSION_LOCKED') {
    useSessionStore.getState().setLocked(true);
  }
  return response;
}

/** Petición que devuelve el cuerpo validado con un esquema Zod o lanza ApiError. */
export async function apiJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const { status, body, requestId } = await apiRequest(path, options);
  if (status < 200 || status >= 300) throw toApiError(status, body, requestId);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(status, 'INVALID_RESPONSE', 'Respuesta inesperada del servidor', {
      requestId,
    });
  }
  return parsed.data;
}

/** Petición sin cuerpo de respuesta (204). */
export async function apiVoid(path: string, options: RequestOptions = {}): Promise<void> {
  const { status, body, requestId } = await apiRequest(path, options);
  if (status < 200 || status >= 300) throw toApiError(status, body, requestId);
}

/** GET tipado (compatibilidad con la Fase 0). */
export function apiGet<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  return apiJson(path, schema, { signal });
}

export { toApiError };

/**
 * Descarga un archivo (CSV) con la sesión y la renovación automática. Devuelve el contenido
 * para que el navegador lo guarde; los errores de la API se convierten en ApiError.
 */
export async function apiDownload(path: string): Promise<Blob> {
  const fetchFile = (): Promise<Response> =>
    fetch(`${getApiBaseUrl()}${path}`, { credentials: 'include' }).catch(() => {
      throw new ApiError(
        0,
        'NETWORK_ERROR',
        'No se pudo conectar con el servidor. Revisa la conexión a internet.',
      );
    });

  let response = await fetchFile();
  if (response.status === 401 && (await refreshSession())) response = await fetchFile();
  if (response.ok) return response.blob();

  const body: unknown = await response.json().catch(() => null);
  if (response.status === 401) clearSession();
  throw toApiError(response.status, body, response.headers.get('X-Request-Id') ?? undefined);
}
