/**
 * Levanta el entorno de las pruebas de punta a punta, aislado del desarrollo:
 *   1. MongoDB en memoria (replica set, para las transacciones) · datos que se borran al terminar
 *   2. Catálogo de la panadería (el mismo seed que `npm run seed:catalog`)
 *   3. La API en el puerto de pruebas, que crea el administrador inicial
 * Playwright lo arranca solo (ver playwright.config.ts) y lo apaga al terminar.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ADMIN, API_PORT, WEB_ORIGIN } from './fixtures/env';

const backendDir = fileURLToPath(new URL('../backend', import.meta.url));

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'warn',
  PORT: String(API_PORT),
  MONGODB_URI: replSet.getUri(),
  MONGODB_DB_NAME: 'panesypan_e2e',
  CORS_ORIGINS: WEB_ORIGIN,
  AUTH_RATE_LIMIT_MAX: '1000',
  JWT_ACCESS_SECRET: 'e2e-secreto-de-acceso-0123456789abcdefghij',
  CSRF_SECRET: 'e2e-secreto-csrf-0123456789abcdefghij-zyxw',
  SEED_ADMIN_NAME: ADMIN.name,
  SEED_ADMIN_USERNAME: ADMIN.username,
  SEED_ADMIN_PASSWORD: ADMIN.initialPassword,
};

/** Ejecuta un archivo TypeScript del backend con tsx (el mismo que usa `npm run dev`). */
const runBackend = (file: string): ChildProcess =>
  spawn(process.execPath, ['--import', 'tsx', file], { cwd: backendDir, env, stdio: 'inherit' });

const seed = runBackend('scripts/seed-catalog.ts');
const [seedCode] = (await once(seed, 'exit')) as [number | null];
if (seedCode !== 0) {
  await replSet.stop();
  throw new Error('No se pudo cargar el catálogo de prueba');
}

const api = runBackend('src/server.ts');

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  api.kill('SIGTERM');
  await replSet.stop();
  process.exit(0);
}

api.on('exit', (code) => {
  if (!stopping) {
    console.error(`[e2e] La API se detuvo (código ${String(code)})`);
    void replSet.stop().then(() => process.exit(1));
  }
});
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
