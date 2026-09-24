/**
 * Keep-alive de MongoDB Atlas: se conecta, hace un ping y una escritura mínima, y se desconecta.
 *
 * Uso:  pnpm db:keepalive
 * Lee MONGODB_URI y MONGODB_DB_NAME del entorno; si no existen, los toma de backend/.env.
 * Está pensado para ejecutarse desde un cron (ver README, sección "Mantener el servicio despierto").
 * Sale con código 0 si todo salió bien y 1 si falló, para que el cron pueda alertar.
 */
import { MongoClient } from 'mongodb';
import { errorMessage, readDatabaseEnv } from './db-env';

interface KeepAliveDocument {
  _id: string;
  lastPingAt: Date;
  count: number;
}

const { uri, dbName } = readDatabaseEnv('keepalive');

const client = new MongoClient(uri, {
  appName: 'panesypan-keepalive',
  serverSelectionTimeoutMS: 15_000,
});

try {
  await client.connect();
  const db = client.db(dbName);
  await db.command({ ping: 1 });
  await db
    .collection<KeepAliveDocument>('keepalive')
    .updateOne(
      { _id: 'keepalive' },
      { $set: { lastPingAt: new Date() }, $inc: { count: 1 } },
      { upsert: true },
    );
  console.log(`[keepalive] OK · ${new Date().toISOString()} · base de datos "${dbName}"`);
} catch (error) {
  // Solo el mensaje: nunca se imprime la cadena de conexión.
  console.error('[keepalive] Falló:', errorMessage(error));
  process.exitCode = 1;
} finally {
  await client.close();
}
