/**
 * Carga la lista de proveedores del sistema anterior (Trytiendas).
 *
 * Uso (desde backend/):
 *   npm run import:proveedores               simulación: no escribe nada
 *   npm run import:proveedores -- --apply    carga de verdad
 *   npm run import:proveedores -- --file=../docs/otro.csv
 *
 * Se puede ejecutar varias veces: no repite proveedores (los reconoce por el nombre).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { slugify, type SupplierDocumentType } from '@panesypan/shared';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { loadEnv } from '../src/config/env';
import { SupplierModel } from '../src/modules/suppliers/supplier.model';
import { parseCsv, tidyName } from './import-utils';

const { values: args } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    file: { type: 'string', default: '../docs/proveedores_trytiendas.csv' },
  },
});

/** "SIN CIUDAD" y similares son relleno del sistema anterior: se dejan en blanco. */
const clean = (value: string | undefined): string =>
  /^sin\s/i.test((value ?? '').trim()) ? '' : (value ?? '').trim();

function documentTypeOf(raw: string | undefined): SupplierDocumentType {
  const key = slugify(raw ?? '');
  if (key === 'nit') return 'NIT';
  if (key.startsWith('cedula')) return 'CC';
  return '';
}

let exitCode = 0;
try {
  const rows = parseCsv(readFileSync(resolve(args.file), 'utf8'));
  const env = loadEnv();
  await connectDatabase({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
  await SupplierModel.init();
  console.log(
    `[proveedores] ${args.apply ? 'CARGA' : 'SIMULACIÓN (no se escribe nada)'} · ${String(rows.length)} filas · base "${env.MONGODB_DB_NAME}"`,
  );

  const taken = new Set((await SupplierModel.find().select('slug')).map((s) => s.slug));
  let created = 0;
  let skipped = 0;
  for (const row of rows) {
    const name = tidyName(row.razon_social ?? '').slice(0, 80);
    const slug = slugify(name);
    if (name.length < 2 || taken.has(slug)) {
      skipped += 1;
      console.log(`[proveedores]   Se omite (ya existe o sin nombre): "${name}"`);
      continue;
    }
    taken.add(slug);
    created += 1;
    if (!args.apply) continue;
    await SupplierModel.create({
      name,
      slug,
      documentType: documentTypeOf(row.tipo_documento),
      documentNumber: (row.numero_documento ?? '').slice(0, 30),
      phone: (row.telefono_principal ?? '').slice(0, 30),
      email: (row.correo_principal ?? '').slice(0, 80),
      city: clean(row.ciudad).slice(0, 60),
      address: (row.direccion_principal ?? '').slice(0, 120),
    });
  }
  console.log(
    `[proveedores] ${args.apply ? 'Creados' : 'Por crear'}: ${String(created)} · omitidos: ${String(skipped)}`,
  );
  if (!args.apply)
    console.log('[proveedores] Para cargar de verdad: npm run import:proveedores -- --apply');
} catch (error) {
  console.error(`[proveedores] ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await disconnectDatabase().catch(() => undefined);
}
process.exit(exitCode);
