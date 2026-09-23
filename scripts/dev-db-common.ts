import { MongoClient } from 'mongodb';

export const DEV_DB_PORT = 27017;
export const DEV_DB_REPLICA_SET = 'rs0';
export const DEV_DB_URI = `mongodb://127.0.0.1:${String(DEV_DB_PORT)}/?replicaSet=${DEV_DB_REPLICA_SET}`;

/** Conexión directa al nodo local (sin descubrir el replica set). */
export function createDirectClient(timeoutMs: number): MongoClient {
  return new MongoClient(`mongodb://127.0.0.1:${String(DEV_DB_PORT)}/?directConnection=true`, {
    serverSelectionTimeoutMS: timeoutMs,
  });
}

/** Indica si ya hay un MongoDB respondiendo en el puerto local de desarrollo. */
export async function isDevDatabaseRunning(timeoutMs = 1_500): Promise<boolean> {
  const client = createDirectClient(timeoutMs);
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    return true;
  } catch {
    return false;
  } finally {
    await client.close();
  }
}
