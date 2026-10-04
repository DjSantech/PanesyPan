/**
 * Respaldo completo de la base de datos en un archivo comprimido.
 *
 * Uso:  pnpm db:backup                      (guarda en backups/ y conserva los 10 más recientes)
 *       pnpm db:backup -- --keep 20         (conserva otra cantidad)
 *       pnpm db:backup -- --out D:/respaldos
 * Lee MONGODB_URI y MONGODB_DB_NAME del entorno o de backend/.env.
 * - Lee todas las colecciones en un mismo instante (snapshot): el respaldo es consistente
 *   aunque la panadería esté vendiendo mientras corre.
 * - Escribe primero un archivo .partial y lo renombra al terminar: nunca queda un respaldo a medias.
 * - La carpeta backups/ está en .gitignore: los respaldos nunca se suben al repositorio.
 * Atlas solo acepta las IP autorizadas: ver README, "Respaldos".
 */
import { once } from 'node:events';
import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createGzip } from 'node:zlib';
import { BSON, MongoClient, type ClientSession, type Db } from 'mongodb';
import {
  BACKUP_DIR_NAME,
  BACKUP_FILE_PATTERN,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  type BackupCollection,
  type BackupHeader,
} from './backup-format';
import { connectWithDnsFallback, errorMessage, readDatabaseEnv } from './db-env';

const TAG = 'backup';
const DEFAULT_KEEP = 10;

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    keep: { type: 'string', default: String(DEFAULT_KEEP) },
  },
});
const keep = Number(values.keep);
if (!Number.isInteger(keep) || keep < 1) {
  console.error(`[${TAG}] --keep debe ser un entero mayor que 0`);
  process.exit(1);
}
const outDir =
  values.out === undefined
    ? fileURLToPath(new URL(`../${BACKUP_DIR_NAME}`, import.meta.url))
    : resolve(values.out);

const { uri, dbName } = readDatabaseEnv(TAG);
const client = new MongoClient(uri, {
  appName: 'panesypan-backup',
  serverSelectionTimeoutMS: 15_000,
});

async function describeCollections(db: Db, session: ClientSession): Promise<BackupCollection[]> {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((info) => info.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();
  const collections: BackupCollection[] = [];
  for (const name of names) {
    const collection = db.collection(name);
    const indexes = (await collection.indexes()).filter((index) => index.name !== '_id_');
    collections.push({
      name,
      count: await collection.countDocuments({}, { session }),
      indexes: indexes.map(({ v: _version, ns: _namespace, ...index }) => index),
    });
  }
  return collections;
}

/** Escribe una línea respetando la contrapresión del gzip (no llena la memoria). */
async function writeLine(stream: NodeJS.WritableStream, line: string): Promise<void> {
  if (!stream.write(`${line}\n`)) await once(stream, 'drain');
}

function pruneOldBackups(): string[] {
  const files = readdirSync(outDir)
    .filter((name) => BACKUP_FILE_PATTERN.test(name))
    .sort()
    .reverse();
  const removed = files.slice(keep);
  for (const name of removed) rmSync(join(outDir, name));
  return removed;
}

mkdirSync(outDir, { recursive: true });
const fileName = backupFileName(new Date());
const finalPath = join(outDir, fileName);
const partialPath = `${finalPath}.partial`;

try {
  await connectWithDnsFallback(client);
  const db = client.db(dbName);
  const session = client.startSession({ snapshot: true });
  try {
    const collections = await describeCollections(db, session);
    const header: BackupHeader = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      dbName,
      collections,
    };

    const gzip = createGzip({ level: 9 });
    const file = createWriteStream(partialPath);
    gzip.pipe(file);
    await writeLine(gzip, JSON.stringify(header));
    for (const { name } of collections) {
      for await (const doc of db.collection(name).find({}, { session })) {
        await writeLine(
          gzip,
          `{"c":${JSON.stringify(name)},"d":${BSON.EJSON.stringify(doc, { relaxed: false })}}`,
        );
      }
    }
    gzip.end();
    await once(file, 'close');
    renameSync(partialPath, finalPath);

    const total = collections.reduce((sum, item) => sum + item.count, 0);
    const sizeKb = Math.max(1, Math.round(statSync(finalPath).size / 1024));
    console.log(
      `[${TAG}] OK · ${String(total)} documentos de ${String(collections.length)} colecciones`,
    );
    for (const item of collections) console.log(`[${TAG}]   ${item.name}: ${String(item.count)}`);
    console.log(`[${TAG}] Archivo: ${finalPath} (${String(sizeKb)} KB)`);
    const removed = pruneOldBackups();
    if (removed.length > 0) {
      console.log(
        `[${TAG}] Se borraron ${String(removed.length)} respaldos viejos (se conservan ${String(keep)})`,
      );
    }
  } finally {
    await session.endSession();
  }
} catch (error) {
  rmSync(partialPath, { force: true });
  console.error(`[${TAG}] Falló:`, errorMessage(error));
  process.exitCode = 1;
} finally {
  await client.close();
}
