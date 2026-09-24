/**
 * Restaura un respaldo hecho con `pnpm db:backup`.
 *
 * Uso:  pnpm db:restore -- backups/panesypan-2026-09-24-2130.ndjson.gz --confirm panesypan
 *       pnpm db:restore -- <archivo> --confirm panesypan --replace   (borra lo que haya antes)
 * Lee MONGODB_URI y MONGODB_DB_NAME del entorno o de backend/.env.
 * Protecciones:
 * - Exige --confirm con el nombre exacto de la base de datos de destino.
 * - Si alguna colección de destino tiene datos, se detiene salvo que se pase --replace.
 * - Al final compara la cantidad de documentos con la del respaldo.
 * Detén la API antes de restaurar (en Render: Suspend) para que nadie venda mientras tanto.
 */
import { createReadStream, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { createGunzip } from 'node:zlib';
import { BSON, MongoClient, type Db, type Document } from 'mongodb';
import { isBackupHeader, type BackupHeader, type BackupLine } from './backup-format';
import { errorMessage, readDatabaseEnv } from './db-env';

const TAG = 'restore';
const BATCH_SIZE = 500;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    confirm: { type: 'string' },
    replace: { type: 'boolean', default: false },
  },
});

const fail = (message: string): never => {
  console.error(`[${TAG}] ${message}`);
  process.exit(1);
};

const [fileArg] = positionals;
if (fileArg === undefined) fail('Indica el archivo: pnpm db:restore -- <archivo> --confirm <base>');
const filePath = resolve(fileArg ?? '');
if (!existsSync(filePath)) fail(`No existe el archivo ${filePath}`);

const { uri, dbName } = readDatabaseEnv(TAG);
if (values.confirm !== dbName) {
  fail(
    `Para restaurar sobre "${dbName}" agrega --confirm ${dbName}. Esto reemplaza datos: revisa que sea la base correcta.`,
  );
}

function readLines(): AsyncIterable<string> {
  return createInterface({
    input: createReadStream(filePath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
}

async function readHeader(): Promise<BackupHeader> {
  for await (const line of readLines()) {
    const parsed: unknown = JSON.parse(line);
    if (!isBackupHeader(parsed)) fail('El archivo no es un respaldo de Panes & Panes');
    return parsed as BackupHeader;
  }
  return fail('El respaldo está vacío');
}

async function prepareTarget(db: Db, header: BackupHeader): Promise<void> {
  const busy: string[] = [];
  for (const { name } of header.collections) {
    if ((await db.collection(name).estimatedDocumentCount()) > 0) busy.push(name);
  }
  if (busy.length === 0) return;
  if (!values.replace) {
    fail(
      `Estas colecciones ya tienen datos: ${busy.join(', ')}. Usa --replace para borrarlas y restaurar.`,
    );
  }
  for (const name of busy) await db.collection(name).drop();
  console.log(`[${TAG}] Se borraron ${String(busy.length)} colecciones con datos anteriores`);
}

async function insertDocuments(db: Db): Promise<Map<string, number>> {
  const inserted = new Map<string, number>();
  const pending = new Map<string, Document[]>();
  const flush = async (name: string): Promise<void> => {
    const batch = pending.get(name) ?? [];
    if (batch.length === 0) return;
    await db.collection(name).insertMany(batch, { ordered: true });
    inserted.set(name, (inserted.get(name) ?? 0) + batch.length);
    pending.set(name, []);
  };

  let isHeader = true;
  for await (const line of readLines()) {
    if (isHeader) {
      isHeader = false;
      continue;
    }
    if (line.trim() === '') continue;
    const { c: name, d: doc } = BSON.EJSON.parse(line, { relaxed: false }) as BackupLine;
    const batch = pending.get(name) ?? [];
    batch.push(doc as Document);
    pending.set(name, batch);
    if (batch.length >= BATCH_SIZE) await flush(name);
  }
  for (const name of pending.keys()) await flush(name);
  return inserted;
}

const client = new MongoClient(uri, {
  appName: 'panesypan-restore',
  serverSelectionTimeoutMS: 15_000,
});

try {
  const header = await readHeader();
  console.log(`[${TAG}] Respaldo del ${header.createdAt} (base "${header.dbName}") → "${dbName}"`);
  await client.connect();
  const db = client.db(dbName);
  await prepareTarget(db, header);

  const inserted = await insertDocuments(db);
  for (const { name, indexes } of header.collections) {
    if (!(await db.listCollections({ name }).hasNext())) await db.createCollection(name);
    if (indexes.length > 0) await db.collection(name).createIndexes(indexes);
  }

  const mismatches = header.collections.filter(
    ({ name, count }) => (inserted.get(name) ?? 0) !== count,
  );
  for (const { name, count } of header.collections) {
    console.log(`[${TAG}]   ${name}: ${String(inserted.get(name) ?? 0)} de ${String(count)}`);
  }
  if (mismatches.length > 0) {
    throw new Error(`Faltan documentos en: ${mismatches.map((item) => item.name).join(', ')}`);
  }
  console.log(`[${TAG}] OK · restauración completa`);
} catch (error) {
  console.error(`[${TAG}] Falló:`, errorMessage(error));
  process.exitCode = 1;
} finally {
  await client.close();
}
