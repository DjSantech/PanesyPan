import { createServer } from 'node:http';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { EnvValidationError, loadEnv, type Env } from './config/env';
import { createLogger } from './config/logger';
import { authConfigFromEnv } from './modules/auth/auth.config';
import { ensureInitialAdmin } from './modules/auth/bootstrap-admin';
import { ensureSystemProfiles } from './modules/profiles/profiles.service';
import { startEInvoiceWorker } from './modules/einvoice/einvoice.worker';
import { createRealtime } from './modules/realtime/realtime';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function readEnvOrExit(): Env {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const env = readEnvOrExit();
const logger = createLogger(env);

try {
  await connectDatabase({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME }, logger);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  logger.fatal({ reason }, 'No se pudo conectar a MongoDB');
  if (env.NODE_ENV === 'development') {
    logger.fatal('¿Está corriendo la base de datos local? Ejecuta "pnpm dev:db" en otra terminal.');
  }
  process.exit(1);
}

try {
  await ensureInitialAdmin(env, logger);
  await ensureSystemProfiles();
} catch (error) {
  logger.fatal(
    { reason: error instanceof Error ? error.message : String(error) },
    'Administrador inicial inválido',
  );
  process.exit(1);
}

const server = createServer(createApp(env, logger));
const realtime = createRealtime(server, { env, authConfig: authConfigFromEnv(env), logger });
const stopEInvoiceWorker = startEInvoiceWorker(logger);

server.listen(env.PORT, () => {
  logger.info(`API escuchando en http://localhost:${String(env.PORT)} (${env.NODE_ENV})`);
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Cerrando la API…');

  const forceExit = setTimeout(() => {
    logger.error('Cierre forzado: se agotó el tiempo de espera');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  await stopEInvoiceWorker();
  await realtime.close();
  server.close();
  server.closeIdleConnections();
  await disconnectDatabase();
  logger.info('API detenida correctamente');
  process.exit(0);
}

process.on('SIGTERM', (signal) => void shutdown(signal));
process.on('SIGINT', (signal) => void shutdown(signal));
