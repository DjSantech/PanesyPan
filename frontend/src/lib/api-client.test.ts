import { healthResponseSchema, type AuthSessionResponse } from '@panesypan/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDatabaseHealth } from '@/features/system-status/health.api';
import { useSessionStore } from '@/stores/session.store';
import { requestUrl } from '@/test/fetch-helpers';
import { ApiError, apiGet, apiJson, apiRequest, getApiBaseUrl } from './api-client';
import { queryClient, SESSION_QUERY_KEY } from './query-client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-12345678' },
  });
}

const errorBody = (code: string, message = 'Error') => ({ error: { code, message } });

const session: AuthSessionResponse = {
  user: {
    id: '66f1a2b3c4d5e6f708192a3b',
    name: 'Laura Gómez',
    username: 'laura',
    email: null,
    role: 'CASHIER',
    permissions: ['pos:sell', 'cash:operate'],
    mustChangePassword: false,
    hasPin: true,
  },
  csrfToken: 'token-csrf-nuevo',
  session: { locked: false, expiresAt: '2026-09-24T05:00:00.000Z', idleLockMinutes: 10 },
};

const fetchMock = vi.fn<typeof fetch>();
const calledUrls = () => fetchMock.mock.calls.map(([url]) => requestUrl(url));

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.panesypan.test/');
  vi.stubGlobal('fetch', fetchMock);
  useSessionStore.setState({ csrfToken: 'token-csrf', locked: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  queryClient.clear();
});

describe('getApiBaseUrl', () => {
  it('quita la barra final', () => {
    expect(getApiBaseUrl()).toBe('https://api.panesypan.test');
  });

  it('falla con un mensaje claro si falta la variable', () => {
    vi.stubEnv('VITE_API_URL', '');
    expect(() => getApiBaseUrl()).toThrow(/VITE_API_URL/);
  });
});

describe('peticiones', () => {
  const health = {
    status: 'ok',
    uptimeSeconds: 120,
    version: '0.1.0',
    commit: null,
    timestamp: '2026-09-23T15:30:00.000Z',
  };

  it('envía cookies y valida la respuesta con el esquema compartido', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, health));

    await expect(apiGet('/api/health', healthResponseSchema)).resolves.toEqual(health);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.panesypan.test/api/health');
    expect(init?.credentials).toBe('include');
  });

  it('envía el token CSRF solo en peticiones que modifican datos', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));

    await apiRequest('/api/v1/auth/lock', { method: 'POST' });
    await apiRequest('/api/v1/users');

    const headersOf = (index: number) => new Headers(fetchMock.mock.calls[index]?.[1]?.headers);
    expect(headersOf(0).get('X-CSRF-Token')).toBe('token-csrf');
    expect(headersOf(1).get('X-CSRF-Token')).toBeNull();
  });

  it('convierte errores de la API en ApiError con código y requestId', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, {
        error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes', requestId: 'abc-12345' },
      }),
    );

    const error = await apiGet('/api/health', healthResponseSchema).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'RATE_LIMITED', requestId: 'abc-12345' });
  });

  it('extrae los errores por campo', () => {
    const error = new ApiError(400, 'VALIDATION_ERROR', 'Datos inválidos', {
      details: [
        { path: 'newPassword', message: 'Muy corta' },
        { path: 'newPassword', message: 'Otro' },
      ],
    });
    expect(error.fieldErrors()).toEqual({ newPassword: 'Muy corta' });
  });

  it('rechaza respuestas que no cumplen el esquema', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: 'ok' }));
    await expect(apiGet('/api/health', healthResponseSchema)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('informa errores de red en español', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiGet('/api/health', healthResponseSchema)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: expect.stringMatching(/No se pudo conectar con el servidor/) as unknown,
    });
  });
});

describe('renovación de la sesión', () => {
  it('ante un 401 renueva la sesión una vez y repite la petición', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, errorBody('UNAUTHORIZED')))
      .mockResolvedValueOnce(jsonResponse(200, session))
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));

    const response = await apiRequest('/api/v1/users');

    expect(response.status).toBe(200);
    expect(calledUrls()).toEqual([
      'https://api.panesypan.test/api/v1/users',
      'https://api.panesypan.test/api/v1/auth/refresh',
      'https://api.panesypan.test/api/v1/users',
    ]);
    expect(useSessionStore.getState().csrfToken).toBe('token-csrf-nuevo');
  });

  it('varias peticiones con 401 comparten un único refresco', async () => {
    fetchMock.mockImplementation((input) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(jsonResponse(200, session));
      const refreshed = calledUrls().some((called) => called.endsWith('/auth/refresh'));
      return Promise.resolve(
        refreshed ? jsonResponse(200, { ok: true }) : jsonResponse(401, errorBody('UNAUTHORIZED')),
      );
    });

    await Promise.all([apiRequest('/api/v1/a'), apiRequest('/api/v1/b'), apiRequest('/api/v1/c')]);

    expect(calledUrls().filter((url) => url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('si no se puede renovar, olvida la sesión local', async () => {
    queryClient.setQueryData(SESSION_QUERY_KEY, session);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, errorBody('UNAUTHORIZED')))
      .mockResolvedValueOnce(jsonResponse(401, errorBody('UNAUTHORIZED')));

    const response = await apiRequest('/api/v1/users');

    expect(response.status).toBe(401);
    expect(queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull();
    expect(useSessionStore.getState().csrfToken).toBeNull();
  });

  it('una contraseña incorrecta no intenta renovar la sesión', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, errorBody('INVALID_CREDENTIALS')));

    await expect(
      apiJson('/api/v1/auth/login', healthResponseSchema, {
        method: 'POST',
        body: {},
        skipRefresh: true,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(calledUrls()).toHaveLength(1);
  });

  it('un 423 bloquea la pantalla', async () => {
    fetchMock.mockResolvedValue(jsonResponse(423, errorBody('SESSION_LOCKED')));
    await apiRequest('/api/v1/users');
    expect(useSessionStore.getState().locked).toBe(true);
  });
});

describe('fetchDatabaseHealth', () => {
  it('interpreta el 503 como base de datos caída', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { status: 'error', database: 'down' }));
    await expect(fetchDatabaseHealth()).resolves.toEqual({ status: 'error', database: 'down' });
  });
});
