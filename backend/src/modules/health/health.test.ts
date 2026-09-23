import { databaseHealthResponseSchema, healthResponseSchema } from '@panesypan/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../../../test/database';
import { createTestEnv, silentLogger } from '../../../test/helpers';
import { createApp } from '../../app';

const ORIGIN_SECRET = 'x'.repeat(40);

describe('GET /api/health', () => {
  const app = createApp(createTestEnv(), silentLogger);

  it('responde 200 con uptime y versión sin consultar la base de datos', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    const body = healthResponseSchema.parse(response.body);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.commit).toBeNull();
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('genera un X-Request-Id o reutiliza uno válido', async () => {
    const generated = await request(app).get('/api/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const reused = await request(app).get('/api/health').set('X-Request-Id', 'tablet-caja-1-abc');
    expect(reused.headers['x-request-id']).toBe('tablet-caja-1-abc');

    const replaced = await request(app).get('/api/health').set('X-Request-Id', '<script>');
    expect(replaced.headers['x-request-id']).not.toBe('<script>');
  });

  it('no está sujeto al rate limit', async () => {
    const limitedApp = createApp(createTestEnv({ RATE_LIMIT_MAX: '2' }), silentLogger);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(limitedApp).get('/api/health');
      expect(response.status).toBe(200);
    }
  });

  it('no exige el header secreto de Cloudflare', async () => {
    const protectedApp = createApp(
      createTestEnv({ ORIGIN_VERIFY_SECRET: ORIGIN_SECRET }),
      silentLogger,
    );
    const response = await request(protectedApp).get('/api/health');
    expect(response.status).toBe(200);
  });
});

describe('GET /api/health/db', () => {
  const app = createApp(createTestEnv(), silentLogger);

  it('responde 503 cuando no hay conexión con la base de datos', async () => {
    const response = await request(app).get('/api/health/db');

    expect(response.status).toBe(503);
    expect(databaseHealthResponseSchema.parse(response.body)).toEqual({
      status: 'error',
      database: 'down',
    });
  });

  describe('con la base de datos conectada', () => {
    let stopDatabase: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      stopDatabase = await startTestDatabase();
    });

    afterAll(async () => {
      await stopDatabase?.();
    });

    it('responde 200 con la latencia del ping', async () => {
      const response = await request(app).get('/api/health/db');

      expect(response.status).toBe(200);
      const body = databaseHealthResponseSchema.parse(response.body);
      expect(body.status).toBe('ok');
      if (body.status === 'ok') {
        expect(body.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
