import type { Request } from 'express';

/**
 * IP real del cliente.
 * - Detrás de Cloudflare (con verificación de origen activa) se usa `CF-Connecting-IP`,
 *   que Cloudflare siempre sobrescribe y no puede ser falsificado por el cliente.
 * - En otro caso se usa `req.ip`, que respeta la configuración `trust proxy`.
 */
export function getClientIp(req: Request, trustCloudflareHeader: boolean): string {
  if (trustCloudflareHeader) {
    const cloudflareIp = req.get('cf-connecting-ip');
    if (cloudflareIp !== undefined && cloudflareIp.length > 0) {
      return cloudflareIp;
    }
  }
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
