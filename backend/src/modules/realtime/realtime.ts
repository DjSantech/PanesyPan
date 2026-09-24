import { createHash, timingSafeEqual } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { DASHBOARD_CHANGED_EVENT, hasPermission, REALTIME_PATH } from '@panesypan/shared';
import type { Logger } from 'pino';
import { Server, type Socket } from 'socket.io';
import type { Env } from '../../config/env';
import { cookieNames } from '../../lib/auth-cookies';
import { verifyAccessToken } from '../../lib/tokens';
import type { AuthConfig } from '../auth/auth.config';
import { SessionModel } from '../auth/session.model';
import { isSessionUsable } from '../auth/session.service';
import { UserModel } from '../users/user.model';

const DASHBOARD_ROOM = 'dashboard';
/** Varios cambios seguidos (un cobro toca ventas, caja e inventario) se avisan como uno solo. */
const NOTIFY_DEBOUNCE_MS = 300;
/** Cada cuánto se confirma que las sesiones conectadas siguen vigentes. */
const REVALIDATE_INTERVAL_MS = 60_000;

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

export interface Realtime {
  close(): Promise<void>;
}

let current: Server | null = null;
let pending: NodeJS.Timeout | null = null;

/**
 * Avisa a los administradores conectados que los datos del dashboard cambiaron. No envía
 * datos: cada cliente vuelve a pedir el resumen por la API, que valida el permiso.
 * Sin servidor de tiempo real activo (pruebas, scripts) no hace nada.
 */
export function notifyDashboardChanged(): void {
  if (current === null || pending !== null) return;
  pending = setTimeout(() => {
    pending = null;
    current?.to(DASHBOARD_ROOM).emit(DASHBOARD_CHANGED_EVENT);
  }, NOTIFY_DEBOUNCE_MS);
  pending.unref();
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(raw));
    } catch {
      cookies.set(name, raw);
    }
  }
  return cookies;
}

interface SocketIdentity {
  userId: string;
  sessionId: string;
}

/** La sesión sigue viva, el usuario está activo y conserva el permiso de reportes. */
async function isIdentityValid({ userId, sessionId }: SocketIdentity): Promise<boolean> {
  const session = await SessionModel.findById(sessionId);
  if (session === null || !isSessionUsable(session) || session.userId.toString() !== userId) {
    return false;
  }
  const user = await UserModel.findById(userId);
  return user?.isActive === true && hasPermission(user.role, 'reports:read');
}

async function identify(socket: Socket, authConfig: AuthConfig): Promise<SocketIdentity | null> {
  const token = parseCookies(socket.handshake.headers.cookie).get(
    cookieNames(authConfig.cookies).access,
  );
  if (token === undefined || token === '') return null;
  const claims = await verifyAccessToken(token, authConfig.accessTokenSecret);
  if (claims === null) return null;
  const identity = { userId: claims.userId, sessionId: claims.sessionId };
  return (await isIdentityValid(identity)) ? identity : null;
}

/**
 * Socket.IO sobre el mismo servidor HTTP de la API. Las mismas reglas que la API REST:
 * origen permitido, header secreto de Cloudflare, sesión válida verificada en la base de
 * datos y permiso de reportes (solo el administrador).
 */
export function createRealtime(
  server: HttpServer,
  deps: { env: Env; authConfig: AuthConfig; logger: Logger },
): Realtime {
  const { env, authConfig, logger } = deps;
  const allowedOrigins = new Set(env.CORS_ORIGINS);
  const expectedSecret =
    env.ORIGIN_VERIFY_SECRET === undefined ? null : sha256(env.ORIGIN_VERIFY_SECRET);

  const io = new Server(server, {
    path: REALTIME_PATH,
    serveClient: false,
    cors: { origin: [...allowedOrigins], credentials: true },
    // CORS no protege el WebSocket: el origen se verifica a mano en cada conexión.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (origin === undefined || !allowedOrigins.has(origin)) {
        callback('Origen no permitido', false);
        return;
      }
      if (expectedSecret !== null) {
        const provided = req.headers['x-origin-verify'];
        if (typeof provided !== 'string' || !timingSafeEqual(sha256(provided), expectedSecret)) {
          callback('Acceso no permitido', false);
          return;
        }
      }
      callback(null, true);
    },
  });

  io.use((socket, next) => {
    identify(socket, authConfig)
      .then((identity) => {
        if (identity === null) {
          next(new Error('UNAUTHORIZED'));
          return;
        }
        socket.data = identity;
        next();
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'Error autenticando el socket');
        next(new Error('UNAUTHORIZED'));
      });
  });

  io.on('connection', (socket) => {
    void socket.join(DASHBOARD_ROOM);
  });

  // Si cierran la sesión o desactivan al usuario, el socket se corta en menos de un minuto.
  const revalidate = setInterval(() => {
    void (async () => {
      for (const socket of await io.fetchSockets()) {
        const identity = socket.data as SocketIdentity;
        if (!(await isIdentityValid(identity).catch(() => true))) socket.disconnect(true);
      }
    })();
  }, REVALIDATE_INTERVAL_MS);
  revalidate.unref();

  current = io;
  return {
    close: async () => {
      clearInterval(revalidate);
      if (pending !== null) clearTimeout(pending);
      pending = null;
      current = null;
      await io.close();
    },
  };
}
