/**
 * Conexión a MongoDB para los scripts de mantenimiento (keep-alive, respaldo, restauración).
 * Lee MONGODB_URI y MONGODB_DB_NAME del entorno; si no existen, los toma de backend/.env.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface DatabaseEnv {
  uri: string;
  dbName: string;
}

const apiEnvFile = fileURLToPath(new URL('../backend/.env', import.meta.url));

/** Devuelve la conexión o termina el proceso con un mensaje claro (nunca imprime la URI). */
export function readDatabaseEnv(tag: string): DatabaseEnv {
  if (process.env.MONGODB_URI === undefined && existsSync(apiEnvFile)) {
    process.loadEnvFile(apiEnvFile);
  }
  const uri = process.env.MONGODB_URI;
  if (uri === undefined || uri === '') {
    console.error(`[${tag}] Falta la variable MONGODB_URI`);
    process.exit(1);
  }
  return { uri, dbName: process.env.MONGODB_DB_NAME ?? 'panesypan' };
}

/** Mensaje de un error sin datos sensibles (el driver nunca incluye la contraseña). */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
