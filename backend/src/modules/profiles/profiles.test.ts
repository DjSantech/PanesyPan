import {
  apiErrorResponseSchema,
  authSessionResponseSchema,
  listProfilesResponseSchema,
  PERMISSIONS,
  profileResponseSchema,
  ROLE_PERMISSIONS,
  userResponseSchema,
} from '@panesypan/shared';
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

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);
const errorCode = (body: unknown) => apiErrorResponseSchema.parse(body).error.code;

let stopDatabase: (() => Promise<void>) | undefined;
let admin: LoggedIn;

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
});

afterAll(async () => {
  await stopDatabase?.();
});

beforeEach(async () => {
  await resetDatabase();
  await createTestUser({ username: 'admin', role: 'ADMIN' });
  admin = await login(app, 'admin', DEFAULT_PASSWORD);
});

const send = (who: LoggedIn, method: 'post' | 'patch', path: string, body: object) =>
  who.agent[method](`/api/v1${path}`).set('X-CSRF-Token', who.csrfToken).send(body);

const permissionsOf = async (who: LoggedIn) =>
  authSessionResponseSchema.parse((await who.agent.get('/api/v1/auth/me')).body).user.permissions;

describe('perfiles de permisos', () => {
  it('crea los perfiles del sistema; el de administrador no se modifica', async () => {
    const list = listProfilesResponseSchema.parse(
      (await admin.agent.get('/api/v1/profiles')).body,
    ).items;
    const adminProfile = list.find((p) => p.systemRole === 'ADMIN');
    const cashierProfile = list.find((p) => p.systemRole === 'CASHIER');
    expect(adminProfile?.permissions).toEqual([...PERMISSIONS]);
    expect(adminProfile?.isEditable).toBe(false);
    expect(cashierProfile?.permissions).toEqual([...ROLE_PERMISSIONS.CASHIER]);

    const response = await send(admin, 'patch', `/profiles/${adminProfile?.id ?? ''}`, {
      permissions: [],
    });
    expect(response.status).toBe(409);
  });

  it('sin perfil asignado, la cajera conserva los permisos de su rol', async () => {
    const { user } = await createTestUser({ role: 'CASHIER' });
    const cashier = await login(app, user.username, DEFAULT_PASSWORD);
    expect(await permissionsOf(cashier)).toEqual([...ROLE_PERMISSIONS.CASHIER]);
    expect((await cashier.agent.get('/api/v1/reports/dashboard')).status).toBe(403);
  });

  it('un perfil propio da y quita acceso a rutas', async () => {
    const { user } = await createTestUser({ role: 'CASHIER' });
    const cashier = await login(app, user.username, DEFAULT_PASSWORD);
    expect((await cashier.agent.get('/api/v1/audit-logs')).status).toBe(403);
    expect((await cashier.agent.get('/api/v1/categories')).status).toBe(200);

    const created = await send(admin, 'post', '/profiles', {
      name: 'Auditora',
      permissions: ['audit:read'],
    });
    expect(created.status).toBe(201);
    const profile = profileResponseSchema.parse(created.body).profile;

    const assigned = await send(admin, 'patch', `/users/${user.id}/profile`, {
      profileId: profile.id,
    });
    expect(userResponseSchema.parse(assigned.body).user.profileId).toBe(profile.id);

    // El cambio aplica de inmediato, sin volver a ingresar.
    expect((await cashier.agent.get('/api/v1/audit-logs')).status).toBe(200);
    const denied = await cashier.agent.get('/api/v1/categories');
    expect(denied.status).toBe(403);
    expect(errorCode(denied.body)).toBe('FORBIDDEN');
    expect(await permissionsOf(cashier)).toEqual(['audit:read']);

    const actions = (await AuditLogModel.find().lean()).map((log) => log.action);
    expect(actions).toEqual(expect.arrayContaining(['PROFILE_CREATED', 'USER_PROFILE_CHANGED']));
  });

  it('editar el perfil Cajera cambia los permisos de las cajeras sin perfil', async () => {
    const list = listProfilesResponseSchema.parse(
      (await admin.agent.get('/api/v1/profiles')).body,
    ).items;
    const cashierProfile = list.find((p) => p.systemRole === 'CASHIER');
    const { user } = await createTestUser({ role: 'CASHIER' });
    const cashier = await login(app, user.username, DEFAULT_PASSWORD);

    const response = await send(admin, 'patch', `/profiles/${cashierProfile?.id ?? ''}`, {
      permissions: [...ROLE_PERMISSIONS.CASHIER, 'reports:read'],
    });
    expect(response.status).toBe(200);
    expect(await permissionsOf(cashier)).toContain('reports:read');
    expect(await AuditLogModel.exists({ action: 'PROFILE_UPDATED' })).not.toBeNull();
  });

  it('un administrador nunca pierde permisos aunque tenga un perfil reducido', async () => {
    const { user } = await createTestUser({ username: 'socia', role: 'ADMIN' });
    const created = await send(admin, 'post', '/profiles', { name: 'Vacío', permissions: [] });
    const profile = profileResponseSchema.parse(created.body).profile;
    await send(admin, 'patch', `/users/${user.id}/profile`, { profileId: profile.id });

    const socia = await login(app, 'socia', DEFAULT_PASSWORD);
    expect(await permissionsOf(socia)).toEqual([...PERMISSIONS]);
    expect((await socia.agent.get('/api/v1/users')).status).toBe(200);
  });
});
