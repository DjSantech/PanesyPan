/**
 * Formato de los respaldos de Panes & Panes: un archivo .ndjson.gz con
 *   1.ª línea  → encabezado (versión, fecha, colecciones con su cantidad e índices)
 *   resto      → un documento por línea: { "c": colección, "d": documento en EJSON canónico }
 * El EJSON canónico conserva los tipos de MongoDB (ObjectId, fechas, enteros), así que
 * restaurar deja la base exactamente igual.
 */
import type { IndexDescription } from 'mongodb';

export const BACKUP_FORMAT = 'panesypan-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_DIR_NAME = 'backups';
export const BACKUP_FILE_PATTERN = /^panesypan-\d{4}-\d{2}-\d{2}-\d{4}\.ndjson\.gz$/;

export interface BackupCollection {
  name: string;
  count: number;
  /** Índices sin el de _id (MongoDB lo crea solo). */
  indexes: IndexDescription[];
}

export interface BackupHeader {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  dbName: string;
  collections: BackupCollection[];
}

export interface BackupLine {
  c: string;
  d: unknown;
}

export function isBackupHeader(value: unknown): value is BackupHeader {
  if (typeof value !== 'object' || value === null) return false;
  const header = value as Partial<BackupHeader>;
  return (
    header.format === BACKUP_FORMAT &&
    header.version === BACKUP_VERSION &&
    typeof header.dbName === 'string' &&
    Array.isArray(header.collections)
  );
}

/** Nombre del archivo con la fecha y hora de Colombia: panesypan-2026-09-24-2130.ndjson.gz */
export function backupFileName(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '00';
  return `panesypan-${part('year')}-${part('month')}-${part('day')}-${part('hour')}${part('minute')}.ndjson.gz`;
}
