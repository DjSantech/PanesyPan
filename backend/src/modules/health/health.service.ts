import type { DatabaseHealthResponse, HealthResponse } from '@panesypan/shared';
import type { AppInfo } from '../../config/app-info';
import { pingDatabase } from '../../config/database';

/** Estado del proceso. No toca la base de datos: debe ser instantáneo. */
export function getHealth(appInfo: AppInfo, now: Date = new Date()): HealthResponse {
  return {
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    version: appInfo.version,
    commit: appInfo.commit,
    timestamp: now.toISOString(),
  };
}

/** Estado de la base de datos mediante `ping`. */
export async function getDatabaseHealth(): Promise<DatabaseHealthResponse> {
  const result = await pingDatabase();
  return result.ok
    ? { status: 'ok', database: 'up', latencyMs: result.latencyMs }
    : { status: 'error', database: 'down' };
}
