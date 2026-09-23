import type { Request } from 'express';
import { getClientIp } from './client-ip';

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
  requestId: string | null;
}

/** Datos de la petición que se guardan en sesiones y auditoría (sin headers sensibles). */
export function getRequestMeta(req: Request, trustCloudflareHeader: boolean): RequestMeta {
  const userAgent = req.get('user-agent');
  return {
    ip: getClientIp(req, trustCloudflareHeader),
    userAgent: userAgent === undefined ? null : userAgent.slice(0, 200),
    requestId: typeof req.id === 'string' ? req.id : null,
  };
}
