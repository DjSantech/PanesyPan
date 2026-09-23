import { emailSchema, passwordProblem, usernameSchema } from '@panesypan/shared';
import type { Logger } from 'pino';
import type { Env } from '../../config/env';
import { hashSecret } from '../../lib/password';
import { recordAudit } from '../audit/audit.service';
import { UserModel } from '../users/user.model';

export type BootstrapResult = 'created' | 'already-exists' | 'not-configured';

export class BootstrapAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapAdminError';
  }
}

/**
 * Crea el primer administrador con las variables SEED_ADMIN_* si todavía no existe ninguno.
 * - No hay credenciales en el código: todo sale de variables de entorno.
 * - El administrador debe cambiar la contraseña en su primer ingreso.
 * - Si ya hay un administrador, no hace nada (es seguro dejarlo en cada arranque).
 */
export async function ensureInitialAdmin(
  env: Pick<
    Env,
    'SEED_ADMIN_NAME' | 'SEED_ADMIN_USERNAME' | 'SEED_ADMIN_EMAIL' | 'SEED_ADMIN_PASSWORD'
  >,
  logger?: Logger,
): Promise<BootstrapResult> {
  if (env.SEED_ADMIN_USERNAME === undefined || env.SEED_ADMIN_PASSWORD === undefined) {
    return 'not-configured';
  }
  if ((await UserModel.exists({ role: 'ADMIN' })) !== null) {
    logger?.info('Ya existe un administrador: se ignoran las variables SEED_ADMIN_*');
    return 'already-exists';
  }

  const username = usernameSchema.safeParse(env.SEED_ADMIN_USERNAME);
  if (!username.success) {
    throw new BootstrapAdminError('SEED_ADMIN_USERNAME no es un nombre de usuario válido');
  }
  const email =
    env.SEED_ADMIN_EMAIL === undefined ? null : emailSchema.safeParse(env.SEED_ADMIN_EMAIL);
  if (email !== null && !email.success) {
    throw new BootstrapAdminError('SEED_ADMIN_EMAIL no es un correo válido');
  }
  const problem = passwordProblem(env.SEED_ADMIN_PASSWORD, username.data);
  if (problem !== null) {
    throw new BootstrapAdminError(`SEED_ADMIN_PASSWORD no es segura: ${problem}`);
  }

  const user = await UserModel.create({
    name: env.SEED_ADMIN_NAME ?? 'Administrador',
    username: username.data,
    email: email?.data ?? null,
    role: 'ADMIN',
    passwordHash: await hashSecret(env.SEED_ADMIN_PASSWORD),
    mustChangePassword: true,
  });
  await recordAudit(
    {
      action: 'USER_CREATED',
      actor: null,
      entity: { type: 'USER', id: user.id, label: user.username },
      metadata: { role: 'ADMIN', source: 'SEED_ADMIN' },
    },
    logger,
  );
  logger?.warn(
    `Administrador inicial "${user.username}" creado. Deberá cambiar la contraseña al ingresar. ` +
      'Por seguridad, elimina SEED_ADMIN_PASSWORD de las variables de entorno.',
  );
  return 'created';
}
