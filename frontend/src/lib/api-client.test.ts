import { healthResponseSchema } from '@panesypan/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDatabaseHealth } from '@/features/system-status/health.api';
import { ApiError, apiGet, getApiBaseUrl } from './api-client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-12345678' },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.panesypan.test/');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
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

describe('apiGet', () => {
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
      message: 'No se pudo conectar con el servidor',
    });
  });
});

describe('fetchDatabaseHealth', () => {
  it('interpreta el 503 como base de datos caída', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { status: 'error', database: 'down' }));

    await expect(fetchDatabaseHealth()).resolves.toEqual({ status: 'error', database: 'down' });
  });
});
