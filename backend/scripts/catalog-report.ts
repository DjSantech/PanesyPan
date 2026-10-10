/**
 * Revisión del catálogo, SOLO LECTURA (no cambia nada en la base):
 * - Cuenta los productos (activos, archivados, con código, con inventario y stock).
 * - Escribe `.local/productos-por-categoria.csv` (se abre en Excel) para revisar qué producto
 *   quedó en qué categoría después de cargar el inventario del sistema anterior.
 * - Si encuentra el CSV exportado de Trytiendas, dice qué códigos de allá no están aquí.
 *
 * Uso (desde backend/):  npm run catalog:report
 *                        npm run catalog:report -- --trytiendas=../docs/otro.csv
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { loadEnv } from '../src/config/env';
import { CategoryModel, ProductModel } from '../src/modules/catalog/catalog.models';
import { InventoryItemModel } from '../src/modules/inventory/inventory.models';
import { toCsv } from '../src/modules/reports/csv';
import { parseCsv } from './import-utils';

const { values: args } = parseArgs({
  options: {
    trytiendas: { type: 'string', default: '../docs/inventario_trytiendas_panes_y_pan.csv' },
  },
});

/** Con lean() los productos viejos no traen los campos nuevos (subcategoría): llegan vacíos. */
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const reportPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../.local/productos-por-categoria.csv',
);

let exitCode = 0;
try {
  const env = loadEnv();
  await connectDatabase({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  const [products, categories, stock] = await Promise.all([
    ProductModel.find().lean(),
    CategoryModel.find().sort({ sortOrder: 1, name: 1 }).lean(),
    InventoryItemModel.find().lean(),
  ]);
  const categoryById = new Map(categories.map((category) => [category._id.toString(), category]));
  const stockByProduct = new Map(stock.map((item) => [item.productId.toString(), item.quantity]));

  const active = products.filter((product) => product.isActive);
  const tracked = active.filter((product) => product.trackStock);
  console.log(`[catalogo] Productos: ${String(products.length)}`);
  console.log(
    `  activos: ${String(active.length)} · archivados: ${String(products.length - active.length)}`,
  );
  console.log(
    `  con código: ${String(products.filter((product) => (product.code ?? null) !== null).length)}`,
  );
  console.log(`  activos con inventario: ${String(tracked.length)}`);
  console.log(
    `  con stock mayor a cero: ${String(tracked.filter((product) => (stockByProduct.get(product._id.toString()) ?? 0) > 0).length)}`,
  );
  console.log(
    `  activos sin costo: ${String(active.filter((product) => (product.cost ?? null) === null).length)}`,
  );

  console.log('[catalogo] Por categoría (activos / total):');
  for (const category of categories) {
    const inCategory = products.filter(
      (product) => product.categoryId.toString() === category._id.toString(),
    );
    const activeCount = inCategory.filter((product) => product.isActive).length;
    console.log(`  ${category.name}: ${String(activeCount)} / ${String(inCategory.length)}`);
  }

  const order = new Map(categories.map((category, index) => [category._id.toString(), index]));
  const rows = [...products]
    .sort(
      (a, b) =>
        (order.get(a.categoryId.toString()) ?? 0) - (order.get(b.categoryId.toString()) ?? 0) ||
        text(a.subcategory).localeCompare(text(b.subcategory), 'es') ||
        a.name.localeCompare(b.name, 'es'),
    )
    .map((product) => [
      categoryById.get(product.categoryId.toString())?.name ?? '',
      text(product.subcategory),
      product.code ?? '',
      product.name,
      product.price,
      product.cost ?? null,
      product.trackStock ? (stockByProduct.get(product._id.toString()) ?? 0) : null,
      product.isActive ? 'Sí' : 'No',
    ]);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    toCsv(
      ['Categoría', 'Subcategoría', 'Código', 'Nombre', 'Precio', 'Costo', 'Stock', 'Activo'],
      rows,
    ),
    'utf8',
  );
  console.log(`[catalogo] Listado por categoría → ${reportPath}`);

  const trytiendasPath = resolve(process.cwd(), args.trytiendas);
  if (existsSync(trytiendasPath)) {
    const source = parseCsv(readFileSync(trytiendasPath, 'utf8'));
    const codes = new Set(products.map((product) => product.code ?? ''));
    const missing = source.filter(
      (row) => (row.codigo ?? '') !== '' && !codes.has(row.codigo ?? ''),
    );
    console.log(
      `[catalogo] Trytiendas: ${String(source.length)} filas · ${String(missing.length)} códigos que no están aquí`,
    );
    for (const row of missing.slice(0, 30)) {
      console.log(`  ${row.codigo ?? ''} · ${row.nombre ?? ''}`);
    }
  } else {
    console.log('[catalogo] No encontré el CSV de Trytiendas: no comparo códigos.');
  }
} catch (error) {
  console.error(`[catalogo] ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await disconnectDatabase().catch(() => undefined);
}
process.exit(exitCode);
