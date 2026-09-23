import { hasPermission, type Permission } from '@panesypan/shared';
import type { Request, RequestHandler } from 'express';
import { readAccessToken } from '../../lib/auth-cookies';
import { AppError } from '../../lib/errors';
import { UNSAFE_METHODS } from '../../lib/http';
import { isValidCsrfToken, verifyAccessToken } from '../../lib/tokens';
import { UserModel } from '../users/user.model';
import type { AuthConfig } from './auth.config';
import type { AuthContext } from './auth.service';
import { SessionModel } from './session.model';
import { isSessionLocked, isSessionUsable } from './session.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- así se extiende el Request de Express
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/** La última actividad se guarda como máximo una vez por minuto (evita una escritura por petición). */
const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

export interface AuthenticateOptions {
  /** Permite la ruta aunque la sesión esté bloqueada (me, lock, unlock). */
  allowLocked?: boolean;
  /** Permite la ruta aunque el usuario deba cambiar su contraseña. */
  allowPasswordChange?: boolean;
}

export interface AuthGuards {
  authenticate(options?: AuthenticateOptions): RequestHandler;
  requirePermission(permission: Permission): RequestHandler;
}

const unauthorized = (): AppError =>
  new AppError(401, 'UNAUTHORIZED', 'Tu sesión terminó. Vuelve a ingresar.');

/** Devuelve el contexto de autenticación o responde 401 si la ruta no pasó por `authenticate`. */
export function getAuth(req: Request): AuthContext {
  if (req.auth === undefined) throw unauthorized();
  return req.auth;
}

export function createAuthGuards(config: AuthConfig): AuthGuards {
  /**
   * Valida el token de acceso y, sobre todo, la sesión y el usuario en la base de datos:
   * cerrar sesión, desactivar un usuario o cambiarle el rol tiene efecto inmediato.
   */
  const authenticate =
    (options: AuthenticateOptions = {}): RequestHandler =>
    async (req, _res, next) => {
      const token = readAccessToken(req, config.cookies);
      if (token === undefined) throw unauthorized();

      const claims = await verifyAccessToken(token, config.accessTokenSecret);
      if (claims === null) throw unauthorized();

      const now = new Date();
      const session = await SessionModel.findById(claims.sessionId);
      if (
        session === null ||
        !isSessionUsable(session, now) ||
        session.userId.toString() !== claims.userId
      ) {
        throw unauthorized();
      }

      const user = await UserModel.findById(claims.userId);
      if (!user?.isActive) throw unauthorized();

      if (
        UNSAFE_METHODS.has(req.method) &&
        !isValidCsrfToken(req.get('x-csrf-token'), session.id, config.csrfSecret)
      ) {
        throw new AppError(
          403,
          'CSRF_INVALID',
          'La solicitud no se pudo verificar. Recarga la página e intenta de nuevo.',
        );
      }

      if (isSessionLocked(session, now)) {
        if (session.lockedAt === null) {
          session.lockedAt = now;
          await SessionModel.updateOne(
            { _id: session._id, lockedAt: null },
            { $set: { lockedAt: now } },
          );
        }
        if (options.allowLocked !== true) {
          throw new AppError(423, 'SESSION_LOCKED', 'La sesión está bloqueada. Ingresa tu PIN.');
        }
      } else if (now.getTime() - session.lastActivityAt.getTime() > ACTIVITY_WRITE_INTERVAL_MS) {
        session.lastActivityAt = now;
        await SessionModel.updateOne({ _id: session._id }, { $set: { lastActivityAt: now } });
      }

      if (user.mustChangePassword && options.allowPasswordChange !== true) {
        throw new AppError(
          403,
          'PASSWORD_CHANGE_REQUIRED',
          'Debes cambiar tu contraseña antes de continuar.',
        );
      }

      req.auth = { user, session };
      next();
    };

  const requirePermission =
    (permission: Permission): RequestHandler =>
    (req, _res, next) => {
      const { user } = getAuth(req);
      if (!hasPermission(user.role, permission)) {
        throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para realizar esta acción.');
      }
      next();
    };

  return { authenticate, requirePermission };
}
