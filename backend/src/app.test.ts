import { apiErrorResponseSchema } from '@panesypan/shared';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestEnv, silentLogger } from '../test/helpers';
import { createApp } from './app';
import { createErrorHandler } from './middlewares/error-handler';
import { createRequestLogger } from './middlewares/request-logger';

const ORIGIN_SECRET = 's'.repeat(48);

describe('respuestas de error', () => {
  const app = createApp(createTestEnv(), silentLogger);

  it('devuelve 404 en JSON con requestId para rutas inexistentes', async () => {
    const response = await request(app).get('/api/v1/no-existe');

    expect(response.status).toBe(404);
    const body = apiErrorResponseSchema.parse(response.body);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(response.headers['x-request-id']);
  });

  it('rechaza JSON mal formado con 400', async () => {
    const response = await request(app)
      .post('/api/v1/cualquiera')
      .set('Content-Type', 'application/json')
      .send('{"total": 12500,');

    expect(response.status).toBe(400);
    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('INVALID_JSON');
  });

  it('rechaza cuerpos de más de 100 kb con 413', async () => {
    const response = await request(app)
      .post('/api/v1/cualquiera')
      .send({ note: 'a'.repeat(120 * 1024) });

    expect(response.status).toBe(413);
    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('en producción oculta el mensaje y el stack de errores inesperados', async () => {
    const failingApp = express();
    failingApp.use(createRequestLogger(silentLogger));
    failingApp.get('/falla', () => {
      throw new Error('detalle interno secreto');
    });
    failingApp.use(createErrorHandler('production'));

    const response = await request(failingApp).get('/falla');

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('secreto');
    expect(JSON.stringify(response.body)).not.toContain('stack');
    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('INTERNAL_ERROR');
  });
});

describe('protección contra inyección NoSQL', () => {
  const app = createApp(createTestEnv(), silentLogger);

  it.each([
    ['operador en la raíz', { username: 'admin', password: { $ne: null } }],
    ['operador anidado', { filter: { items: [{ price: { $gt: 0 } }] } }],
    ['clave con punto', { 'profile.role': 'ADMIN' }],
  ])('rechaza %s', async (_caso, payload) => {
    const response = await request(app).post('/api/v1/cualquiera').send(payload);

    expect(response.status).toBe(400);
    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('INVALID_INPUT');
  });

  it('rechaza __proto__ (contaminación de prototipos)', async () => {
    const response = await request(app)
      .post('/api/v1/cualquiera')
      .set('Content-Type', 'application/json')
      .send('{"__proto__": {"isAdmin": true}}');

    expect(response.status).toBe(400);
  });

  it('deja pasar cuerpos válidos', async () => {
    const response = await request(app)
      .post('/api/v1/cualquiera')
      .send({ items: [{ productId: 'abc', quantity: 2 }], note: 'sin azúcar' });

    // Llega al enrutador (404 porque la ruta aún no existe), no a la validación.
    expect(response.status).toBe(404);
  });
});

describe('headers de seguridad', () => {
  const app = createApp(createTestEnv(), silentLogger);

  it('aplica helmet y no revela la tecnología del servidor', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeDefined();
    expect(response.headers['content-security-policy']).toBeDefined();
  });
});

describe('CORS', () => {
  const app = createApp(
    createTestEnv({ CORS_ORIGINS: 'http://localhost:5173, https://sistema.panesypan.com/' }),
    silentLogger,
  );

  it('permite orígenes configurados con credenciales', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'https://sistema.panesypan.com');

    expect(response.headers['access-control-allow-origin']).toBe('https://sistema.panesypan.com');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('no autoriza orígenes desconocidos', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'https://evil.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('responde el preflight con los headers permitidos', async () => {
    const response = await request(app)
      .options('/api/v1/sales')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-headers']).toContain('X-CSRF-Token');
  });
});

describe('rate limit', () => {
  it('limita las rutas de negocio con 429', async () => {
    const app = createApp(createTestEnv({ RATE_LIMIT_MAX: '2' }), silentLogger);

    await request(app).get('/api/v1/cualquiera').expect(404);
    await request(app).get('/api/v1/cualquiera').expect(404);
    const blocked = await request(app).get('/api/v1/cualquiera');

    expect(blocked.status).toBe(429);
    expect(apiErrorResponseSchema.parse(blocked.body).error.code).toBe('RATE_LIMITED');
  });

  it('detrás de Cloudflare cuenta por la IP real del cliente (CF-Connecting-IP)', async () => {
    const app = createApp(
      createTestEnv({ RATE_LIMIT_MAX: '1', ORIGIN_VERIFY_SECRET: ORIGIN_SECRET }),
      silentLogger,
    );
    const from = (ip: string) =>
      request(app)
        .get('/api/v1/cualquiera')
        .set('X-Origin-Verify', ORIGIN_SECRET)
        .set('CF-Connecting-IP', ip);

    expect((await from('181.50.10.1')).status).toBe(404);
    expect((await from('181.50.10.1')).status).toBe(429);
    expect((await from('190.60.20.2')).status).toBe(404);
  });
});

describe('verificación de origen (Cloudflare)', () => {
  const app = createApp(createTestEnv({ ORIGIN_VERIFY_SECRET: ORIGIN_SECRET }), silentLogger);

  it('bloquea peticiones sin el header secreto', async () => {
    const response = await request(app).get('/api/v1/cualquiera');

    expect(response.status).toBe(403);
    expect(apiErrorResponseSchema.parse(response.body).error.code).toBe('FORBIDDEN');
  });

  it('bloquea peticiones con un secreto incorrecto', async () => {
    const response = await request(app)
      .get('/api/v1/cualquiera')
      .set('X-Origin-Verify', 'incorrecto');

    expect(response.status).toBe(403);
  });

  it('deja pasar peticiones con el secreto correcto', async () => {
    const response = await request(app)
      .get('/api/v1/cualquiera')
      .set('X-Origin-Verify', ORIGIN_SECRET);

    expect(response.status).toBe(404);
  });
});
