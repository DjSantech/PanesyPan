import {
  apiErrorResponseSchema,
  listUsersResponseSchema,
  userResponseSchema,
  userWithTemporaryPasswordSchema,
} from '@panesypan/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../../../test/database';
import {
  createTestUser,
  DEFAULT_PASSWORD,
  initModels,
  login,
  resetDatabase,
  type LoggedIn,
} from '../../../test/factories';
import { createTestEnv, silentLogger } from '../../../test/helpers';
import { createApp } from '../../app';
import { AuditLogModel } from '../audit/audit-log.model';
import { UserModel } from './user.model';

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);
const errorCode = (body: unknown) => apiErrorResponseSchema.parse(body).error.code;

let stopDatabase: (() => Promise<void>) | undefined;
let admin: LoggedIn;
let adminId: string;

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
});

afterAll(async () => {
  await stopDatabase?.();
});

beforeEach(async () => {
  await resetDatabase();
  const { user } = await createTestUser({ username: 'admin', name: 'Dueña', role: 'ADMIN' });
  adminId = user.id;
  admin = await login(app, 'admin', DEFAULT_PASSWORD);
});

const post = (path: string, body: object = {}) =>
  admin.agent.post(`/api/v1/users${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);
const patch = (path: string, body: object) =>
  admin.agent.patch(`/api/v1/users${path}`).set('X-CSRF-Token', admin.csrfToken).send(body);

describe('permisos', () => {
  it('sin sesión responde 401', async () => {
    expect((await request(app).get('/api/v1/users')).status).toBe(401);
  });

  it('una cajera no puede gestionar usuarios', async () => {
    const { user } = await createTestUser({ role: 'CASHIER' });
    const cashier = await login(app, user.username, DEFAULT_PASSWORD);

    const response = await cashier.agent.get('/api/v1/users');
    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('FORBIDDEN');

    const create = await cashier.agent
      .post('/api/v1/users')
      .set('X-CSRF-Token', cashier.csrfToken)
      .send({ name: 'Intruso', username: 'intruso', role: 'ADMIN' });
    expect(create.status).toBe(403);
    expect(await UserModel.countDocuments({ username: 'intruso' })).toBe(0);
  });

  it('las modificaciones exigen el token CSRF', async () => {
    const response = await admin.agent
      .post('/api/v1/users')
      .send({ name: 'Laura', username: 'laura', role: 'CASHIER' });
    expect(response.status).toBe(403);
  });
});

describe('crear usuarios', () => {
  it('crea una cajera con contraseña temporal que debe cambiar', async () => {
    const response = await post('', {
      name: 'Laura Gómez',
      username: 'Laura.Gomez',
      role: 'CASHIER',
    });

    expect(response.status).toBe(201);
    const { user, temporaryPassword } = userWithTemporaryPasswordSchema.parse(response.body);
    expect(user).toMatchObject({
      username: 'laura.gomez',
      role: 'CASHIER',
      mustChangePassword: true,
      hasPin: false,
    });
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);

    const cashier = await login(app, 'laura.gomez', temporaryPassword);
    expect(cashier.body.user.mustChangePassword).toBe(true);
    expect(await AuditLogModel.countDocuments({ action: 'USER_CREATED' })).toBe(1);
  });

  it('no permite usuarios o correos repetidos', async () => {
    await post('', {
      name: 'Laura',
      username: 'laura',
      email: 'laura@panes.co',
      role: 'CASHIER',
    }).expect(201);

    const sameUsername = await post('', { name: 'Otra', username: 'LAURA', role: 'CASHIER' });
    expect(sameUsername.status).toBe(409);

    const sameEmail = await post('', {
      name: 'Otra',
      username: 'otra',
      email: 'Laura@Panes.co',
      role: 'CASHIER',
    });
    expect(sameEmail.status).toBe(409);
  });

  it('valida los datos', async () => {
    const response = await post('', { name: 'L', username: 'con espacios', role: 'JEFE' });
    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('VALIDATION_ERROR');
  });
});

describe('listar usuarios', () => {
  it('filtra por estado, rol y búsqueda (sin interpretar la búsqueda como regex)', async () => {
    await createTestUser({ name: 'Laura Gómez', username: 'laura' });
    await createTestUser({ name: 'Marta Ruiz', username: 'marta', isActive: false });

    const active = listUsersResponseSchema.parse((await admin.agent.get('/api/v1/users')).body);
    expect(active.items.map((user) => user.username).sort()).toEqual(['admin', 'laura']);

    const inactive = listUsersResponseSchema.parse(
      (await admin.agent.get('/api/v1/users?status=inactive')).body,
    );
    expect(inactive.items.map((user) => user.username)).toEqual(['marta']);

    const search = listUsersResponseSchema.parse(
      (await admin.agent.get('/api/v1/users?status=all&search=gómez')).body,
    );
    expect(search.items.map((user) => user.username)).toEqual(['laura']);

    const regex = listUsersResponseSchema.parse(
      (await admin.agent.get('/api/v1/users?status=all&search=.*')).body,
    );
    expect(regex.items).toHaveLength(0);
  });
});

describe('editar usuarios', () => {
  it('cambia nombre, correo y rol, y lo registra en la auditoría', async () => {
    const { user } = await createTestUser({ name: 'Laura', username: 'laura' });

    const response = await patch(`/${user.id}`, {
      name: 'Laura Gómez',
      email: 'laura@panes.co',
      role: 'ADMIN',
    });
    expect(response.status).toBe(200);
    expect(userResponseSchema.parse(response.body).user).toMatchObject({
      name: 'Laura Gómez',
      email: 'laura@panes.co',
      role: 'ADMIN',
    });

    const audit = await AuditLogModel.findOne({ action: 'USER_UPDATED' }).lean();
    expect(audit?.metadata).toMatchObject({
      changes: {
        role: { from: 'CASHIER', to: 'ADMIN' },
        name: { from: 'Laura', to: 'Laura Gómez' },
      },
    });
  });

  it('no permite cambiarse el propio rol ni dejar el sistema sin administradores', async () => {
    const own = await patch(`/${adminId}`, { role: 'CASHIER' });
    expect(own.status).toBe(409);
    expect(await UserModel.countDocuments({ role: 'ADMIN' })).toBe(1);
  });

  it('responde 404 con ids inválidos o inexistentes', async () => {
    expect((await admin.agent.get('/api/v1/users/no-es-un-id')).status).toBe(404);
    expect((await admin.agent.get('/api/v1/users/66f1a2b3c4d5e6f708192a3b')).status).toBe(404);
  });
});

describe('activar y desactivar', () => {
  it('al desactivar cierra sus sesiones y no puede volver a ingresar', async () => {
    const { user } = await createTestUser({ username: 'laura' });
    const cashier = await login(app, 'laura', DEFAULT_PASSWORD);

    await patch(`/${user.id}/status`, { isActive: false }).expect(200);

    expect((await cashier.agent.get('/api/v1/auth/me')).status).toBe(401);
    const again = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'laura', password: DEFAULT_PASSWORD });
    expect(errorCode(again.body)).toBe('ACCOUNT_DISABLED');

    await patch(`/${user.id}/status`, { isActive: true }).expect(200);
    expect((await login(app, 'laura', DEFAULT_PASSWORD)).body.user.username).toBe('laura');
    expect(await AuditLogModel.countDocuments({ action: 'USER_DEACTIVATED' })).toBe(1);
    expect(await AuditLogModel.countDocuments({ action: 'USER_ACTIVATED' })).toBe(1);
  });

  it('no permite desactivarse a sí mismo', async () => {
    const response = await patch(`/${adminId}/status`, { isActive: false });
    expect(response.status).toBe(409);
  });

  it('siempre debe quedar un administrador activo', async () => {
    const { user } = await createTestUser({ role: 'ADMIN', username: 'socia' });
    // Se puede desactivar a otra administradora mientras quede una activa…
    await patch(`/${user.id}/status`, { isActive: false }).expect(200);
    // …pero no se puede degradar a la última.
    await createTestUser({ role: 'CASHIER', username: 'laura' });
    const demoteLast = await patch(`/${adminId}`, { role: 'CASHIER' });
    expect(demoteLast.status).toBe(409);
  });
});

describe('restablecer contraseña, PIN y bloqueo', () => {
  it('genera una contraseña temporal y cierra sus sesiones', async () => {
    const { user } = await createTestUser({ username: 'laura' });
    const cashier = await login(app, 'laura', DEFAULT_PASSWORD);

    const response = await post(`/${user.id}/reset-password`);
    expect(response.status).toBe(200);
    const { temporaryPassword, user: updated } = userWithTemporaryPasswordSchema.parse(
      response.body,
    );
    expect(updated.mustChangePassword).toBe(true);

    expect((await cashier.agent.get('/api/v1/auth/me')).status).toBe(401);
    const oldPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: 'laura', password: DEFAULT_PASSWORD });
    expect(oldPassword.status).toBe(401);
    await login(app, 'laura', temporaryPassword);
  });

  it('no permite restablecerse la propia contraseña ni el propio PIN por esta vía', async () => {
    expect((await post(`/${adminId}/reset-password`)).status).toBe(409);
    expect((await post(`/${adminId}/reset-pin`)).status).toBe(409);
  });

  it('restablece el PIN', async () => {
    const { user } = await createTestUser({ username: 'laura' });
    const response = await post(`/${user.id}/reset-pin`);
    expect(userResponseSchema.parse(response.body).user.hasPin).toBe(false);
  });

  it('desbloquea una cuenta bloqueada por intentos fallidos', async () => {
    const { user } = await createTestUser({ username: 'laura' });
    for (let index = 0; index < 5; index += 1) {
      await request(app).post('/api/v1/auth/login').send({ identifier: 'laura', password: 'mala' });
    }
    const listed = userResponseSchema.parse(
      (await admin.agent.get(`/api/v1/users/${user.id}`)).body,
    );
    expect(listed.user.lockedUntil).not.toBeNull();

    const unlocked = await post(`/${user.id}/unlock`);
    expect(userResponseSchema.parse(unlocked.body).user.lockedUntil).toBeNull();
    await login(app, 'laura', DEFAULT_PASSWORD);
  });
});
