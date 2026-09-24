/**
 * Carga el catálogo inicial de la panadería (categorías y productos con sus precios).
 *
 * Uso (desde backend/):  npm run seed:catalog
 * Se puede ejecutar varias veces: solo crea lo que falta y nunca cambia lo que ya existe.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { loadEnv } from '../src/config/env';
import { seedCatalog } from '../src/modules/catalog/catalog.seed';

let exitCode = 0;
try {
  const env = loadEnv();
  await connectDatabase({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const result = await seedCatalog();
  console.log(
    `[seed-catalog] Categorías creadas: ${String(result.categoriesCreated)} · ` +
      `productos creados: ${String(result.productsCreated)} · ` +
      `ya existían: ${String(result.productsSkipped)}`,
  );
} catch (error) {
  console.error(`[seed-catalog] ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await disconnectDatabase().catch(() => undefined);
}
process.exit(exitCode);
