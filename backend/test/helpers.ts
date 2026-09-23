import { pino } from 'pino';
import { loadEnv, type Env } from '../src/config/env';

export const silentLogger = pino({ level: 'silent' });

/** Variables de entorno mínimas para pruebas, con posibilidad de sobrescribir cualquiera. */
export function createTestEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/?replicaSet=rs0',
    ...overrides,
  });
}
