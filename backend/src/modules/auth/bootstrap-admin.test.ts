import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../../../test/database';
import { initModels, resetDatabase } from '../../../test/factories';
import { verifySecret } from '../../lib/password';
import { AuditLogModel } from '../audit/audit-log.model';
import { UserModel } from '../users/user.model';
import { BootstrapAdminError, ensureInitialAdmin } from './bootstrap-admin';

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

const seed = {
  SEED_ADMIN_NAME: 'Dueña de la panadería',
  SEED_ADMIN_USERNAME: 'Duena',
  SEED_ADMIN_EMAIL: 'duena@panes.co',
  SEED_ADMIN_PASSWORD: 'buñuelos de la mañana',
};

describe('ensureInitialAdmin', () => {
  it('no hace nada si no hay variables SEED_ADMIN_*', async () => {
    expect(await ensureInitialAdmin({})).toBe('not-configured');
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it('crea el primer administrador con cambio de contraseña obligatorio', async () => {
    expect(await ensureInitialAdmin(seed)).toBe('created');

    const admin = await UserModel.findOne({ username: 'duena' }).select('+passwordHash');
    expect(admin).toMatchObject({
      role: 'ADMIN',
      mustChangePassword: true,
      email: 'duena@panes.co',
    });
    expect(await verifySecret(admin?.passwordHash ?? '', seed.SEED_ADMIN_PASSWORD)).toBe(true);
    expect(await AuditLogModel.countDocuments({ action: 'USER_CREATED' })).toBe(1);
  });

  it('es seguro ejecutarlo en cada arranque', async () => {
    await ensureInitialAdmin(seed);
    expect(await ensureInitialAdmin({ ...seed, SEED_ADMIN_USERNAME: 'otro' })).toBe(
      'already-exists',
    );
    expect(await UserModel.countDocuments()).toBe(1);
  });

  it('rechaza contraseñas débiles', async () => {
    await expect(ensureInitialAdmin({ ...seed, SEED_ADMIN_PASSWORD: 'admin123' })).rejects.toThrow(
      BootstrapAdminError,
    );
  });
});
