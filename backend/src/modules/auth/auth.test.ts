import { apiErrorResponseSchema, authSessionResponseSchema } from '@panesypan/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../../../test/database';
import {
  createTestUser,
  DEFAULT_PASSWORD,
  DEFAULT_PIN,
  initModels,
  login,
  readCookie,
  resetDatabase,
  setCookieHeaders,
} from '../../../test/factories';
import { createTestEnv, silentLogger } from '../../../test/helpers';
import { createApp } from '../../app';
import { AuditLogModel } from '../audit/audit-log.model';
import { SessionModel } from './session.model';

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);
const errorCode = (body: unknown) => apiErrorResponseSchema.parse(body).error.code;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

let stopDatabase: (() => Promise<void>) | undefined;

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
});

afterAll(async () => {
  await stopDatabase?.();
});

beforeEach(async () => {
  await resetDatabase();
});

describe('POST /auth/login', () => {
  it('inicia sesión y entrega cookies httpOnly + token CSRF', async () => {
    await createTestUser({ username: 'laura', email: 'laura@panes.co', role: 'CASHIER' });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'Laura', password: DEFAULT_PASSWORD });

    expect(response.status).toBe(200);
    const body = authSessionResponseSchema.parse(response.body);
    expect(body.user).toMatchObject({ username: 'laura', role: 'CASHIER', hasPin: true });
    expect(body.user.permissions).toEqual(['pos:sell', 'cash:operate']);
    expect(body.session.locked).toBe(false);
    expect(body.csrfToken.length).toBeGreaterThan(20);
    expect(response.headers['cache-control']).toBe('no-store');

    const cookies = setCookieHeaders(response);
    const access = cookies.find((cookie) => cookie.startsWith('pyp_at='));
    const refresh = cookies.find((cookie) => cookie.startsWith('pyp_rt='));
    expect(access).toMatch(/HttpOnly/);
    expect(access).toMatch(/SameSite=Lax/);
    expect(access).toMatch(/Path=\//);
    expect(refresh).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/);
    expect(refresh).not.toMatch(/Domain=/);

    const audit = await AuditLogModel.findOne({ action: 'AUTH_LOGIN_SUCCESS' });
    expect(audit?.actor?.name).toBeDefined();
  });

  it('permite ingresar con el correo', async () => {
    await createTestUser({ username: 'laura', email: 'laura@panes.co' });
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'LAURA@panes.co', password: DEFAULT_PASSWORD });
    expect(response.status).toBe(200);
  });

  it('responde igual si el usuario no existe o la contraseña es incorrecta', async () => {
    await createTestUser({ username: 'laura' });

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'laura', password: 'no-es-la-clave' });
    const unknownUser = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'nadie', password: 'no-es-la-clave' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(apiErrorResponseSchema.parse(wrongPassword.body).error.message).toBe(
      apiErrorResponseSchema.parse(unknownUser.body).error.message,
    );
    expect(await AuditLogModel.countDocuments({ action: 'AUTH_LOGIN_FAILED' })).toBe(2);
  });

  it('nunca guarda la contraseña intentada en la auditoría', async () => {
    await createTestUser({ username: 'laura' });
    await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'laura', password: 'mi-clave-secreta-123' });

    const logs = await AuditLogModel.find().lean();
    expect(JSON.stringify(logs)).not.toContain('mi-clave-secreta-123');
  });

  it('enmascara el usuario intentado (a veces se escribe la contraseña en ese campo)', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'horno caliente 7am', password: 'x' });

    const log = await AuditLogModel.findOne({ action: 'AUTH_LOGIN_FAILED' }).lean();
    expect(log?.metadata).toMatchObject({ reason: 'UNKNOWN_USER', identifier: 'hor…(18)' });
    expect(JSON.stringify(log)).not.toContain('horno caliente');
  });

  it('bloquea la cuenta tras 5 intentos fallidos, incluso con la contraseña correcta', async () => {
    await createTestUser({ username: 'laura' });
    const attempt = (password: string) =>
      request(app).post('/api/v1/auth/login').send({ identifier: 'laura', password });

    for (let index = 0; index < 4; index += 1) {
      expect((await attempt('mala-clave')).status).toBe(401);
    }
    const fifth = await attempt('mala-clave');
    expect(fifth.status).toBe(423);
    expect(errorCode(fifth.body)).toBe('ACCOUNT_LOCKED');

    const withCorrectPassword = await attempt(DEFAULT_PASSWORD);
    expect(withCorrectPassword.status).toBe(423);
    expect(await AuditLogModel.countDocuments({ action: 'AUTH_ACCOUNT_LOCKED' })).toBe(1);
  });

  it('solo revela que el usuario está desactivado si la contraseña es correcta', async () => {
    await createTestUser({ username: 'laura', isActive: false });

    const wrong = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'laura', password: 'mala-clave' });
    expect(errorCode(wrong.body)).toBe('INVALID_CREDENTIALS');

    const right = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'laura', password: DEFAULT_PASSWORD });
    expect(right.status).toBe(403);
    expect(errorCode(right.body)).toBe('ACCOUNT_DISABLED');
  });

  it('rechaza el login desde un origen no permitido', async () => {
    await createTestUser({ username: 'laura' });
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ identifier: 'laura', password: DEFAULT_PASSWORD });
    expect(response.status).toBe(403);
  });

  it('valida el cuerpo de forma estricta', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'laura', password: 'x', role: 'ADMIN' });
    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('VALIDATION_ERROR');
  });
});

describe('sesión y CSRF', () => {
  it('GET /auth/me exige sesión', async () => {
    const response = await request(app).get('/api/v1/auth/me');
    expect(response.status).toBe(401);
    expect(errorCode(response.body)).toBe('UNAUTHORIZED');
  });

  it('GET /auth/me devuelve el usuario y un token CSRF', async () => {
    const { user } = await createTestUser({ role: 'ADMIN' });
    const { agent } = await login(app, user.username, DEFAULT_PASSWORD);

    const response = await agent.get('/api/v1/auth/me');
    expect(response.status).toBe(200);
    expect(authSessionResponseSchema.parse(response.body).user.role).toBe('ADMIN');
  });

  it('rechaza un token de acceso manipulado', async () => {
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', 'pyp_at=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.firma-falsa');
    expect(response.status).toBe(401);
  });

  it('exige el token CSRF en las peticiones que modifican datos', async () => {
    const { user } = await createTestUser();
    const { agent, csrfToken } = await login(app, user.username, DEFAULT_PASSWORD);

    const withoutToken = await agent.post('/api/v1/auth/lock');
    expect(withoutToken.status).toBe(403);
    expect(errorCode(withoutToken.body)).toBe('CSRF_INVALID');

    const withWrongToken = await agent
      .post('/api/v1/auth/lock')
      .set('X-CSRF-Token', 'x'.repeat(43));
    expect(withWrongToken.status).toBe(403);

    const withToken = await agent.post('/api/v1/auth/lock').set('X-CSRF-Token', csrfToken);
    expect(withToken.status).toBe(204);
  });

  it('el token CSRF de una sesión no sirve en otra', async () => {
    const { user } = await createTestUser();
    const first = await login(app, user.username, DEFAULT_PASSWORD);
    const second = await login(app, user.username, DEFAULT_PASSWORD);

    const response = await second.agent
      .post('/api/v1/auth/lock')
      .set('X-CSRF-Token', first.csrfToken);
    expect(response.status).toBe(403);
  });
});

describe('POST /auth/refresh', () => {
  it('rota el token de refresco', async () => {
    const { user } = await createTestUser();
    const session = await login(app, user.username, DEFAULT_PASSWORD);

    const response = await session.agent.post('/api/v1/auth/refresh');
    expect(response.status).toBe(200);
    const newRefresh = readCookie(response, 'pyp_rt');
    expect(newRefresh).not.toBe('');
    expect(newRefresh).not.toBe(session.refreshCookie);
  });

  it('tolera dos refrescos simultáneos (dos pestañas) sin cerrar la sesión', async () => {
    const { user } = await createTestUser();
    const session = await login(app, user.username, DEFAULT_PASSWORD);

    await session.agent.post('/api/v1/auth/refresh').expect(200);
    const late = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `pyp_rt=${session.refreshCookie}`);

    expect(late.status).toBe(200);
    expect(readCookie(late, 'pyp_rt')).toBe('');
    expect(await SessionModel.countDocuments({ revokedAt: null })).toBe(1);
  });

  it('detecta la reutilización de un token viejo y cierra la sesión', async () => {
    const { user } = await createTestUser();
    const session = await login(app, user.username, DEFAULT_PASSWORD);
    await session.agent.post('/api/v1/auth/refresh').expect(200);

    // Pasa el margen de gracia: el token viejo ya no puede venir de una carrera normal.
    await SessionModel.updateMany({}, { $set: { rotatedAt: minutesAgo(1) } });

    const stolen = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `pyp_rt=${session.refreshCookie}`);
    expect(stolen.status).toBe(401);

    const stored = await SessionModel.findOne();
    expect(stored?.revokedReason).toBe('REUSE_DETECTED');
    expect(await AuditLogModel.countDocuments({ action: 'AUTH_REFRESH_REUSE_DETECTED' })).toBe(1);

    // El dueño legítimo también debe volver a ingresar.
    expect((await session.agent.post('/api/v1/auth/refresh')).status).toBe(401);
  });

  it('sin cookie responde 401', async () => {
    expect((await request(app).post('/api/v1/auth/refresh')).status).toBe(401);
  });
});

describe('cierre de sesión', () => {
  it('POST /auth/logout cierra la sesión y borra las cookies', async () => {
    const { user } = await createTestUser();
    const { agent } = await login(app, user.username, DEFAULT_PASSWORD);

    const response = await agent.post('/api/v1/auth/logout');
    expect(response.status).toBe(204);
    expect(setCookieHeaders(response).some((cookie) => cookie.startsWith('pyp_at=;'))).toBe(true);

    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    expect((await SessionModel.findOne())?.revokedReason).toBe('LOGOUT');
  });

  it('POST /auth/logout-all cierra la sesión en todos los dispositivos', async () => {
    const { user } = await createTestUser();
    const tablet = await login(app, user.username, DEFAULT_PASSWORD);
    const phone = await login(app, user.username, DEFAULT_PASSWORD);

    await phone.agent
      .post('/api/v1/auth/logout-all')
      .set('X-CSRF-Token', phone.csrfToken)
      .expect(204);

    expect((await tablet.agent.get('/api/v1/auth/me')).status).toBe(401);
    expect((await phone.agent.get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('bloqueo por inactividad y PIN', () => {
  it('bloquea la sesión tras 10 minutos sin uso y la desbloquea con el PIN', async () => {
    const { user } = await createTestUser({ role: 'ADMIN' });
    const { agent, csrfToken } = await login(app, user.username, DEFAULT_PASSWORD);
    await SessionModel.updateMany({}, { $set: { lastActivityAt: minutesAgo(11) } });

    const blocked = await agent.get('/api/v1/users');
    expect(blocked.status).toBe(423);
    expect(errorCode(blocked.body)).toBe('SESSION_LOCKED');

    const me = await agent.get('/api/v1/auth/me');
    expect(authSessionResponseSchema.parse(me.body).session.locked).toBe(true);

    const wrongPin = await agent
      .post('/api/v1/auth/unlock')
      .set('X-CSRF-Token', csrfToken)
      .send({ pin: '000001' });
    expect(wrongPin.status).toBe(401);
    expect(apiErrorResponseSchema.parse(wrongPin.body).error).toMatchObject({
      code: 'INVALID_PIN',
      details: { remainingAttempts: 4 },
    });

    const unlocked = await agent
      .post('/api/v1/auth/unlock')
      .set('X-CSRF-Token', csrfToken)
      .send({ pin: DEFAULT_PIN });
    expect(unlocked.status).toBe(200);
    expect(authSessionResponseSchema.parse(unlocked.body).session.locked).toBe(false);

    expect((await agent.get('/api/v1/users')).status).toBe(200);
  });

  it('POST /auth/lock bloquea la sesión de inmediato', async () => {
    const { user } = await createTestUser({ role: 'ADMIN' });
    const { agent, csrfToken } = await login(app, user.username, DEFAULT_PASSWORD);

    await agent.post('/api/v1/auth/lock').set('X-CSRF-Token', csrfToken).expect(204);
    expect((await agent.get('/api/v1/users')).status).toBe(423);
  });

  it('cierra la sesión tras 5 PIN incorrectos', async () => {
    const { user } = await createTestUser();
    const { agent, csrfToken } = await login(app, user.username, DEFAULT_PASSWORD);
    await agent.post('/api/v1/auth/lock').set('X-CSRF-Token', csrfToken).expect(204);

    let last: request.Response | undefined;
    for (let index = 0; index < 5; index += 1) {
      last = await agent
        .post('/api/v1/auth/unlock')
        .set('X-CSRF-Token', csrfToken)
        .send({ pin: '000001' });
    }
    expect(last?.status).toBe(401);
    expect(errorCode(last?.body)).toBe('UNAUTHORIZED');
    expect((await SessionModel.findOne())?.revokedReason).toBe('PIN_ATTEMPTS');
    expect(await AuditLogModel.countDocuments({ action: 'AUTH_SESSION_REVOKED_PIN' })).toBe(1);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('sin PIN configurado pide volver a ingresar con contraseña', async () => {
    const { user } = await createTestUser({ pin: null });
    const { agent, csrfToken } = await login(app, user.username, DEFAULT_PASSWORD);
    await agent.post('/api/v1/auth/lock').set('X-CSRF-Token', csrfToken).expect(204);

    const response = await agent
      .post('/api/v1/auth/unlock')
      .set('X-CSRF-Token', csrfToken)
      .send({ pin: DEFAULT_PIN });
    expect(response.status).toBe(409);
    expect(errorCode(response.body)).toBe('PIN_NOT_SET');
  });
});

describe('cambio obligatorio de contraseña', () => {
  it('bloquea el resto del sistema hasta cambiar la contraseña temporal', async () => {
    const { user } = await createTestUser({ role: 'ADMIN', mustChangePassword: true });
    const tablet = await login(app, user.username, DEFAULT_PASSWORD);
    const other = await login(app, user.username, DEFAULT_PASSWORD);

    const blocked = await tablet.agent.get('/api/v1/users');
    expect(blocked.status).toBe(403);
    expect(errorCode(blocked.body)).toBe('PASSWORD_CHANGE_REQUIRED');

    const wrongCurrent = await tablet.agent
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', tablet.csrfToken)
      .send({ currentPassword: 'mala', newPassword: 'pan de bono caliente' });
    expect(wrongCurrent.status).toBe(400);
    expect(errorCode(wrongCurrent.body)).toBe('INVALID_CREDENTIALS');

    const weak = await tablet.agent
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', tablet.csrfToken)
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: '12345678' });
    expect(weak.status).toBe(400);
    expect(errorCode(weak.body)).toBe('VALIDATION_ERROR');

    const withUsername = await tablet.agent
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', tablet.csrfToken)
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: `${user.username}-2026!` });
    expect(withUsername.status).toBe(400);

    const changed = await tablet.agent
      .post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', tablet.csrfToken)
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'pan de bono caliente' });
    expect(changed.status).toBe(200);
    expect(authSessionResponseSchema.parse(changed.body).user.mustChangePassword).toBe(false);

    expect((await tablet.agent.get('/api/v1/users')).status).toBe(200);
    // La otra sesión se cerró al cambiar la contraseña.
    expect((await other.agent.get('/api/v1/auth/me')).status).toBe(401);
    expect(await AuditLogModel.countDocuments({ action: 'AUTH_PASSWORD_CHANGED' })).toBe(1);
  });
});

describe('PUT /auth/pin', () => {
  it('permite crear el primer PIN sin contraseña', async () => {
    const { user } = await createTestUser({ pin: null });
    const { agent, csrfToken } = await login(app, user.username, DEFAULT_PASSWORD);

    const response = await agent
      .put('/api/v1/auth/pin')
      .set('X-CSRF-Token', csrfToken)
      .send({ pin: '730264' });
    expect(response.status).toBe(200);
    expect(authSessionResponseSchema.parse(response.body).user.hasPin).toBe(true);
  });

  it('rechaza PIN triviales', async () => {
    const { user } = await createTestUser({ pin: null });
    const { agent, csrfToken } = await login(app, user.username, DEFAULT_PASSWORD);

    const response = await agent
      .put('/api/v1/auth/pin')
      .set('X-CSRF-Token', csrfToken)
      .send({ pin: '123456' });
    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('VALIDATION_ERROR');
  });

  it('para cambiar un PIN existente exige la contraseña actual', async () => {
    const { user } = await createTestUser();
    const { agent, csrfToken } = await login(app, user.username, DEFAULT_PASSWORD);
    const put = (body: object) =>
      agent.put('/api/v1/auth/pin').set('X-CSRF-Token', csrfToken).send(body);

    expect((await put({ pin: '730264' })).status).toBe(400);
    expect((await put({ pin: '730264', currentPassword: 'mala-clave' })).status).toBe(400);
    expect((await put({ pin: '730264', currentPassword: DEFAULT_PASSWORD })).status).toBe(200);
  });
});

describe('límite de intentos por IP', () => {
  it('limita los intentos fallidos de login desde la misma IP', async () => {
    const limitedApp = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '3' }), silentLogger);
    await createTestUser({ username: 'laura' });
    const attempt = (identifier: string) =>
      request(limitedApp).post('/api/v1/auth/login').send({ identifier, password: 'mala-clave' });

    // Usuarios distintos para no activar el bloqueo de cuenta.
    for (const identifier of ['a1', 'a2', 'a3'])
      expect((await attempt(identifier)).status).toBe(401);
    const blocked = await attempt('a4');
    expect(blocked.status).toBe(429);
    expect(errorCode(blocked.body)).toBe('RATE_LIMITED');
  });
});
