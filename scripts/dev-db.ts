/**
 * MongoDB local para desarrollo (sin instalar MongoDB ni Docker).
 *
 * Uso:  pnpm dev:db        (déjalo corriendo en una terminal aparte; Ctrl+C para detenerlo)
 *       pnpm dev:db:stop   (lo apaga de forma segura si quedó corriendo en segundo plano)
 * - Levanta un replica set de un nodo en 127.0.0.1:27017 (las transacciones lo exigen).
 * - Los datos se guardan en .local/mongo (ignorado por git) y se conservan entre reinicios.
 * - La primera vez descarga el binario de MongoDB (puede tardar un par de minutos).
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { DEV_DB_PORT, DEV_DB_REPLICA_SET, DEV_DB_URI, isDevDatabaseRunning } from './dev-db-common';

const dbPath = fileURLToPath(new URL('../.local/mongo', import.meta.url));

if (await isDevDatabaseRunning()) {
  // Pasa, por ejemplo, si se cerró la terminal sin Ctrl+C: el proceso de MongoDB sigue vivo.
  console.log(`[dev-db] MongoDB local ya está corriendo: ${DEV_DB_URI}`);
  console.log('[dev-db] Puedes usarlo tal cual. Para apagarlo: pnpm dev:db:stop');
  process.exit(0);
}

mkdirSync(dbPath, { recursive: true });
console.log('[dev-db] Iniciando MongoDB local…');

let replSet: MongoMemoryReplSet;
try {
  replSet = await MongoMemoryReplSet.create({
    replSet: { name: DEV_DB_REPLICA_SET, count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ port: DEV_DB_PORT, dbPath }],
  });
} catch (error) {
  console.error(
    '[dev-db] No se pudo iniciar MongoDB:',
    error instanceof Error ? error.message : error,
  );
  console.error(`[dev-db] ¿Otro programa está usando el puerto ${String(DEV_DB_PORT)}?`);
  process.exit(1);
}

// Verificación rápida: el nodo debe aceptar escrituras (es PRIMARY del replica set).
const client = new MongoClient(DEV_DB_URI, { serverSelectionTimeoutMS: 10_000 });
await client.connect();
await client.db('admin').command({ ping: 1 });
await client.close();

console.log(`[dev-db] Listo: ${DEV_DB_URI}`);
console.log(`[dev-db] Datos en ${dbPath}`);
console.log('[dev-db] Presiona Ctrl+C para detenerlo.');

let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log('\n[dev-db] Deteniendo MongoDB (los datos se conservan)…');
  await replSet.stop({ doCleanup: false });
  process.exit(0);
}

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
