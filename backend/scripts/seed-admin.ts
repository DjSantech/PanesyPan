/**
 * Crea el primer administrador a partir de las variables SEED_ADMIN_* (sin credenciales en el código).
 *
 * Uso (desde backend/):  npm run seed:admin
 * La API hace lo mismo automáticamente al arrancar; este script sirve para hacerlo sin levantarla.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { EnvValidationError, loadEnv } from '../src/config/env';
import { ensureInitialAdmin } from '../src/modules/auth/bootstrap-admin';

let exitCode = 0;
try {
  const env = loadEnv();
  await connectDatabase({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const result = await ensureInitialAdmin(env);
  const messages = {
    created: `Administrador "${env.SEED_ADMIN_USERNAME ?? ''}" creado. Deberá cambiar la contraseña al ingresar.`,
    'already-exists': 'Ya existe un administrador. No se hizo ningún cambio.',
    'not-configured': 'Faltan SEED_ADMIN_USERNAME y SEED_ADMIN_PASSWORD en backend/.env',
  } as const;
  console.log(`[seed-admin] ${messages[result]}`);
  if (result === 'not-configured') exitCode = 1;
} catch (error) {
  const message =
    error instanceof EnvValidationError || error instanceof Error ? error.message : String(error);
  console.error(`[seed-admin] ${message}`);
  exitCode = 1;
} finally {
  await disconnectDatabase().catch(() => undefined);
}
process.exit(exitCode);
