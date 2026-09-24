/**
 * Recuperación de acceso: genera una contraseña temporal para un usuario, lo desbloquea,
 * borra su PIN (lo vuelve a crear al ingresar) y cierra sus sesiones.
 * Sirve cuando el único administrador olvidó su contraseña.
 *
 * Uso (desde backend/):  npm run reset:password -- <usuario>
 */
import { usernameSchema } from '@panesypan/shared';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { loadEnv } from '../src/config/env';
import { hashSecret } from '../src/lib/password';
import { generateTemporaryPassword } from '../src/lib/temporary-password';
import { recordAudit } from '../src/modules/audit/audit.service';
import { revokeUserSessions } from '../src/modules/auth/session.service';
import { UserModel } from '../src/modules/users/user.model';

let exitCode = 0;
try {
  const parsed = usernameSchema.safeParse(process.argv[2] ?? '');
  if (!parsed.success) throw new Error('Indica el usuario: npm run reset:password -- <usuario>');

  const env = loadEnv();
  await connectDatabase({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });

  const user = await UserModel.findOne({ username: parsed.data });
  if (user === null) throw new Error(`No existe el usuario "${parsed.data}"`);

  const temporaryPassword = generateTemporaryPassword();
  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash: await hashSecret(temporaryPassword),
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        pinHash: null,
        pinSetAt: null,
        passwordChangedAt: new Date(),
      },
    },
  );
  const sessionsClosed = await revokeUserSessions(user.id, 'PASSWORD_RESET');
  await recordAudit({
    action: 'USER_PASSWORD_RESET',
    actor: null,
    entity: { type: 'USER', id: user.id, label: user.username },
    metadata: { source: 'SCRIPT', sessionsClosed },
  });

  console.log(`[reset-password] Usuario: ${user.username}`);
  console.log(`[reset-password] Contraseña temporal: ${temporaryPassword}`);
  console.log('[reset-password] Al ingresar deberá cambiarla y crear un PIN nuevo.');
} catch (error) {
  console.error(`[reset-password] ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await disconnectDatabase().catch(() => undefined);
}
process.exit(exitCode);
