/**
 * Apaga de forma segura el MongoDB local de desarrollo (los datos se conservan).
 * Útil si se cerró la terminal de "pnpm dev:db" sin presionar Ctrl+C.
 *
 * Uso:  pnpm dev:db:stop
 */
import { DEV_DB_PORT, createDirectClient, isDevDatabaseRunning } from './dev-db-common';

if (!(await isDevDatabaseRunning())) {
  console.log(
    `[dev-db] No hay ningún MongoDB local corriendo en el puerto ${String(DEV_DB_PORT)}.`,
  );
  process.exit(0);
}

const client = createDirectClient(3_000);
try {
  await client.connect();
  // El servidor cierra la conexión al apagarse, por eso este comando "falla" cuando funciona.
  await client.db('admin').command({ shutdown: 1, timeoutSecs: 5 });
} catch {
  // Esperado: la conexión se cierra durante el apagado.
} finally {
  await client.close().catch(() => undefined);
}

for (let attempt = 0; attempt < 20; attempt += 1) {
  if (!(await isDevDatabaseRunning(500))) {
    console.log('[dev-db] MongoDB local detenido. Los datos siguen en .local/mongo');
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error('[dev-db] MongoDB no se detuvo a tiempo. Ciérralo desde el Administrador de tareas.');
process.exit(1);
