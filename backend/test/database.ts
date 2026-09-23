import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/config/database';

/**
 * Levanta un MongoDB en memoria como replica set (las transacciones lo exigen)
 * y conecta Mongoose. Devuelve la función para apagarlo.
 */
export async function startTestDatabase(): Promise<() => Promise<void>> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await connectDatabase({ uri: replSet.getUri(), dbName: 'panesypan_test' });

  return async () => {
    await disconnectDatabase();
    await replSet.stop();
  };
}
