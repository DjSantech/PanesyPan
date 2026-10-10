import { createHash, timingSafeEqual } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import {
  DASHBOARD_CHANGED_EVENT,
  REALTIME_PATH,
  WEB_ORDERS_CHANGED_EVENT,
} from '@panesypan/shared';
import type { Logger } from 'pino';
import { Server, type Socket } from 'socket.io';
import type { Env } from '../../config/env';
import { cookieNames } from '../../lib/auth-cookies';
import { verifyAccessToken } from '../../lib/tokens';
import type { AuthConfig } from '../auth/auth.config';
import { SessionModel } from '../auth/session.model';
import { isSessionUsable } from '../auth/session.service';
import { resolvePermissions } from '../profiles/effective-permissions';
import { UserModel, type UserDocument } from '../users/user.model';

const DASHBOARD_ROOM = 'dashboard';
const WEB_ORDERS_ROOM = 'web-orders';
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

let pendingWebOrders: NodeJS.Timeout | null = null;

/**
 * Avisa a quienes atienden los pedidos web que la lista cambió (sin datos: cada cliente vuelve
 * a pedirla por la API). Sin servidor de tiempo real activo no hace nada.
 */
export function notifyWebOrdersChanged(): void {
  if (current === null || pendingWebOrders !== null) return;
  pendingWebOrders = setTimeout(() => {
    pendingWebOrders = null;
    current?.to(WEB_ORDERS_ROOM).emit(WEB_ORDERS_CHANGED_EVENT);
  }, NOTIFY_DEBOUNCE_MS);
  pendingWebOrders.unref();
}

/** Salas a las que entra un usuario según sus permisos efectivos (su perfil). */
async function roomsFor(user: UserDocument): Promise<string[]> {
  const permissions = await resolvePermissions(user);
  const rooms: string[] = [];
  if (permissions.includes('reports:read')) rooms.push(DASHBOARD_ROOM);
  if (permissions.includes('web-orders:read')) rooms.push(WEB_ORDERS_ROOM);
  return rooms;
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
  rooms?: string[];
}

/**
 * La sesión sigue viva, el usuario está activo y conserva algún permiso con sala (reportes o
 * pedidos web). Devuelve las salas a las que puede entrar, o null.
 */
async function roomsOfIdentity({ userId, sessionId }: SocketIdentity): Promise<string[] | null> {
  const session = await SessionModel.findById(sessionId);
  if (session === null || !isSessionUsable(session) || session.userId.toString() !== userId) {
    return null;
  }
  const user = await UserModel.findById(userId);
  if (user?.isActive !== true) return null;
  const rooms = await roomsFor(user);
  return rooms.length > 0 ? rooms : null;
}

async function isIdentityValid(identity: SocketIdentity): Promise<boolean> {
  return (await roomsOfIdentity(identity)) !== null;
}

async function identify(socket: Socket, authConfig: AuthConfig): Promise<SocketIdentity | null> {
  const token = parseCookies(socket.handshake.headers.cookie).get(
    cookieNames(authConfig.cookies).access,
  );
  if (token === undefined || token === '') return null;
  const claims = await verifyAccessToken(token, authConfig.accessTokenSecret);
  if (claims === null) return null;
  const identity = { userId: claims.userId, sessionId: claims.sessionId };
  const rooms = await roomsOfIdentity(identity);
  return rooms === null ? null : { ...identity, rooms };
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
    void socket.join((socket.data as SocketIdentity).rooms ?? []);
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
      if (pendingWebOrders !== null) clearTimeout(pendingWebOrders);
      pendingWebOrders = null;
      current = null;
      await io.close();
    },
  };
}
