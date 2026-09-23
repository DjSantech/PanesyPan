import { pino } from 'pino';
import { loadEnv, type Env } from '../src/config/env';

export const silentLogger = pino({ level: 'silent' });

/** Variables de entorno mínimas para pruebas, con posibilidad de sobrescribir cualquiera. */
export function createTestEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/?replicaSet=rs0',
    JWT_ACCESS_SECRET: 'prueba-secreto-de-acceso-0123456789abcdef',
    CSRF_SECRET: 'prueba-secreto-csrf-0123456789abcdef-zyxw',
    ...overrides,
  });
}
