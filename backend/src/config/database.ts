import mongoose from 'mongoose';
import type { Logger } from 'pino';

// Defensa contra inyección NoSQL: los filtros con operadores ($ne, $gt…) que vengan de datos
// del usuario se tratan como valores literales, y los campos no definidos en el esquema se ignoran.
mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);

export interface DatabaseOptions {
  uri: string;
  dbName: string;
}

export async function connectDatabase(options: DatabaseOptions, logger?: Logger): Promise<void> {
  const { connection } = mongoose;
  connection.removeAllListeners('disconnected').removeAllListeners('reconnected');
  connection.on('disconnected', () => logger?.warn('Conexión con MongoDB perdida'));
  connection.on('reconnected', () => logger?.info('Conexión con MongoDB restablecida'));

  await mongoose.connect(options.uri, {
    dbName: options.dbName,
    appName: 'panesypan-api',
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 10,
  });
  logger?.info({ dbName: options.dbName }, 'Conectado a MongoDB');
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export type DatabasePingResult = { ok: true; latencyMs: number } | { ok: false };

/** Hace `ping` a la base de datos con un tiempo máximo de espera. Nunca lanza errores. */
export async function pingDatabase(timeoutMs = 2_000): Promise<DatabasePingResult> {
  const { connection } = mongoose;
  const db = connection.db;
  if (connection.readyState !== mongoose.ConnectionStates.connected || db === undefined) {
    return { ok: false };
  }

  const startedAt = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.admin().ping(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Tiempo de espera agotado'));
        }, timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
