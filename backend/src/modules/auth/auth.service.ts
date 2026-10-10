import {
  AUTH_POLICY,
  passwordProblem,
  type AuthSessionResponse,
  type ChangePasswordRequest,
  type LoginRequest,
  type SetPinRequest,
} from '@panesypan/shared';
import { trusted } from 'mongoose';
import type { Logger } from 'pino';
import { AppError } from '../../lib/errors';
import { hashSecret, verifyAgainstDummy, verifySecret } from '../../lib/password';
import type { RequestMeta } from '../../lib/request-meta';
import {
  createAccessToken,
  createCsrfToken,
  generateRefreshToken,
  hashToken,
} from '../../lib/tokens';
import { recordAudit } from '../audit/audit.service';
import { UserModel, type UserDocument } from '../users/user.model';
import { resolvePermissions } from '../profiles/effective-permissions';
import { toAuditActor, toSessionUser } from '../users/users.mapper';
import type { AuthConfig } from './auth.config';
import { SessionModel, type SessionDocument } from './session.model';
import {
  createSession,
  isSessionLocked,
  revokeSession,
  revokeUserSessions,
} from './session.service';

/**
 * Si un token de refresco recién rotado se vuelve a usar dentro de este margen, se asume una
 * carrera normal (dos pestañas refrescando a la vez) y no un robo.
 */
const REFRESH_REUSE_GRACE_MS = 15_000;

export interface AuthDeps {
  config: AuthConfig;
  logger?: Logger;
}

export interface AuthContext {
  user: UserDocument;
  session: SessionDocument;
}

/** Resultado de una autenticación: respuesta JSON + tokens para las cookies. */
export interface IssuedAuth {
  response: AuthSessionResponse;
  accessToken: string;
  /** Solo cuando se emite un token de refresco nuevo. */
  refreshToken?: string;
  sessionExpiresAt: Date;
}

const userEntity = (user: UserDocument) => ({ type: 'USER', id: user.id, label: user.username });

/**
 * Versión enmascarada de lo que se escribió como usuario ("lau…(9)"). Es común escribir la
 * contraseña en el campo de usuario por error: nunca se guarda completo en la auditoría.
 */
export function maskIdentifier(identifier: string): string {
  const visible = Array.from(identifier).slice(0, 3).join('');
  return `${visible}…(${String(identifier.length)})`;
}
const sessionEntity = (session: SessionDocument) => ({ type: 'SESSION', id: session.id });

const invalidCredentials = (): AppError =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos');

const sessionEnded = (): AppError =>
  new AppError(401, 'UNAUTHORIZED', 'Tu sesión terminó. Vuelve a ingresar.');

const accountLocked = (until: Date, now: Date): AppError => {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));
  return new AppError(
    423,
    'ACCOUNT_LOCKED',
    `Cuenta bloqueada por intentos fallidos. Intenta de nuevo en ${String(minutes)} ${
      minutes === 1 ? 'minuto' : 'minutos'
    } o pide al administrador que la desbloquee.`,
  );
};

export async function buildAuthResponse(
  user: UserDocument,
  session: SessionDocument,
  config: AuthConfig,
  now: Date = new Date(),
): Promise<AuthSessionResponse> {
  await resolvePermissions(user);
  return {
    user: toSessionUser(user),
    csrfToken: createCsrfToken(session.id, config.csrfSecret),
    session: {
      locked: isSessionLocked(session, now),
      expiresAt: session.expiresAt.toISOString(),
      idleLockMinutes: AUTH_POLICY.idleLockMinutes,
    },
  };
}

async function issueAuth(
  user: UserDocument,
  session: SessionDocument,
  deps: AuthDeps,
  refreshToken?: string,
): Promise<IssuedAuth> {
  const accessToken = await createAccessToken(
    { userId: user.id, sessionId: session.id, role: user.role },
    deps.config.accessTokenSecret,
  );
  const issued: IssuedAuth = {
    response: await buildAuthResponse(user, session, deps.config),
    accessToken,
    sessionExpiresAt: session.expiresAt,
  };
  if (refreshToken !== undefined) issued.refreshToken = refreshToken;
  return issued;
}

// ── Login ──────────────────────────────────────────────────────────

/** Suma un intento fallido. Si llega al máximo, bloquea la cuenta y devuelve hasta cuándo. */
async function registerFailedLogin(
  user: UserDocument,
  meta: RequestMeta,
  deps: AuthDeps,
  now: Date,
): Promise<Date | null> {
  const updated = await UserModel.findOneAndUpdate(
    { _id: user._id },
    { $inc: { failedLoginAttempts: 1 } },
    { returnDocument: 'after' },
  );
  const attempts = updated?.failedLoginAttempts ?? AUTH_POLICY.maxLoginAttempts;
  await recordAudit(
    {
      action: 'AUTH_LOGIN_FAILED',
      actor: null,
      entity: userEntity(user),
      metadata: { reason: 'BAD_PASSWORD', attempts },
      meta,
    },
    deps.logger,
  );

  if (attempts < AUTH_POLICY.maxLoginAttempts) return null;

  const lockedUntil = new Date(now.getTime() + AUTH_POLICY.loginLockMinutes * 60_000);
  await UserModel.updateOne({ _id: user._id }, { $set: { lockedUntil, failedLoginAttempts: 0 } });
  await recordAudit(
    {
      action: 'AUTH_ACCOUNT_LOCKED',
      actor: null,
      entity: userEntity(user),
      metadata: { lockedUntil: lockedUntil.toISOString() },
      meta,
    },
    deps.logger,
  );
  return lockedUntil;
}

export async function login(
  input: LoginRequest,
  meta: RequestMeta,
  deps: AuthDeps,
): Promise<IssuedAuth> {
  const now = new Date();
  const user = await UserModel.findOne({
    $or: [{ username: input.identifier }, { email: input.identifier }],
  }).select('+passwordHash');

  if (user === null) {
    // Mismo tiempo de respuesta que con un usuario real: no se puede adivinar quién existe.
    await verifyAgainstDummy(input.password);
    await recordAudit(
      {
        action: 'AUTH_LOGIN_FAILED',
        actor: null,
        metadata: { reason: 'UNKNOWN_USER', identifier: maskIdentifier(input.identifier) },
        meta,
      },
      deps.logger,
    );
    throw invalidCredentials();
  }

  // Con la cuenta bloqueada ni siquiera se verifica la contraseña (frena la fuerza bruta).
  if (user.lockedUntil !== null && user.lockedUntil > now) {
    throw accountLocked(user.lockedUntil, now);
  }

  if (!(await verifySecret(user.passwordHash, input.password))) {
    const lockedUntil = await registerFailedLogin(user, meta, deps, now);
    if (lockedUntil !== null) throw accountLocked(lockedUntil, now);
    throw invalidCredentials();
  }

  // El estado de la cuenta solo se revela después de una contraseña correcta.
  if (!user.isActive) {
    await recordAudit(
      {
        action: 'AUTH_LOGIN_FAILED',
        actor: null,
        entity: userEntity(user),
        metadata: { reason: 'INACTIVE' },
        meta,
      },
      deps.logger,
    );
    throw new AppError(
      403,
      'ACCOUNT_DISABLED',
      'Tu usuario está desactivado. Habla con el administrador.',
    );
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = now;
  await user.save();

  const { session, refreshToken } = await createSession(user.id, user.role, meta, now);
  await recordAudit(
    {
      action: 'AUTH_LOGIN_SUCCESS',
      actor: toAuditActor(user),
      entity: sessionEntity(session),
      meta,
    },
    deps.logger,
  );
  return issueAuth(user, session, deps, refreshToken);
}

// ── Refresco con rotación y detección de reuso ─────────────────────

export async function refresh(
  refreshToken: string | undefined,
  meta: RequestMeta,
  deps: AuthDeps,
): Promise<IssuedAuth> {
  if (refreshToken === undefined) throw sessionEnded();

  const now = new Date();
  const tokenHash = hashToken(refreshToken);
  const newRefreshToken = generateRefreshToken();

  const session = await SessionModel.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: trusted({ $gt: now }) },
    {
      $set: { tokenHash: hashToken(newRefreshToken), rotatedAt: now },
      $push: { previousTokenHashes: { $each: [tokenHash], $slice: -10 } },
    },
    { returnDocument: 'after' },
  );

  if (session !== null) {
    const user = await UserModel.findById(session.userId);
    if (!user?.isActive) {
      await revokeSession(session.id, 'USER_DEACTIVATED');
      throw sessionEnded();
    }
    return issueAuth(user, session, deps, newRefreshToken);
  }

  // El token no es el actual: ¿es uno ya usado?
  const reused = await SessionModel.findOne({ previousTokenHashes: tokenHash });
  if (reused === null) throw sessionEnded();

  const isBenignRace =
    reused.revokedAt === null &&
    reused.expiresAt > now &&
    now.getTime() - reused.rotatedAt.getTime() < REFRESH_REUSE_GRACE_MS &&
    reused.previousTokenHashes.at(-1) === tokenHash;

  if (isBenignRace) {
    // La otra pestaña ya guardó el token nuevo: solo se entrega un token de acceso.
    const user = await UserModel.findById(reused.userId);
    if (!user?.isActive) throw sessionEnded();
    return issueAuth(user, reused, deps);
  }

  // Alguien usó un token viejo: posible robo. Se cierra la sesión completa.
  if (reused.revokedAt === null) {
    await revokeSession(reused.id, 'REUSE_DETECTED');
    const owner = await UserModel.findById(reused.userId);
    await recordAudit(
      {
        action: 'AUTH_REFRESH_REUSE_DETECTED',
        actor: null,
        entity: owner === null ? sessionEntity(reused) : userEntity(owner),
        metadata: { sessionId: reused.id },
        meta,
      },
      deps.logger,
    );
  }
  throw sessionEnded();
}

// ── Cierre de sesión ───────────────────────────────────────────────

export async function logout(
  input: { sessionId?: string; refreshToken?: string },
  meta: RequestMeta,
  deps: AuthDeps,
): Promise<void> {
  let session: SessionDocument | null = null;
  if (input.sessionId !== undefined) session = await SessionModel.findById(input.sessionId);
  if (session === null && input.refreshToken !== undefined) {
    session = await SessionModel.findOne({ tokenHash: hashToken(input.refreshToken) });
  }
  if (session === null) return; // ya no existe
  if (session.revokedAt !== null) return; // ya estaba cerrada

  await revokeSession(session.id, 'LOGOUT');
  const user = await UserModel.findById(session.userId);
  if (user !== null) {
    await recordAudit(
      { action: 'AUTH_LOGOUT', actor: toAuditActor(user), entity: sessionEntity(session), meta },
      deps.logger,
    );
  }
}

export async function logoutAll(
  auth: AuthContext,
  meta: RequestMeta,
  deps: AuthDeps,
): Promise<void> {
  const closed = await revokeUserSessions(auth.user.id, 'LOGOUT_ALL');
  await recordAudit(
    {
      action: 'AUTH_LOGOUT_ALL',
      actor: toAuditActor(auth.user),
      entity: userEntity(auth.user),
      metadata: { sessionsClosed: closed },
      meta,
    },
    deps.logger,
  );
}

// ── Bloqueo por inactividad y PIN ──────────────────────────────────

export async function lockSession(auth: AuthContext): Promise<void> {
  await SessionModel.updateOne(
    { _id: auth.session._id, lockedAt: null },
    { $set: { lockedAt: new Date() } },
  );
}

export type UnlockResult =
  | { ok: true; issued: IssuedAuth }
  | { ok: false; remainingAttempts: number; sessionClosed: boolean };

export async function unlockSession(
  auth: AuthContext,
  pin: string,
  meta: RequestMeta,
  deps: AuthDeps,
): Promise<UnlockResult> {
  const user = await UserModel.findById(auth.user._id).select('+pinHash');
  if (user === null) throw sessionEnded();
  if (user.pinHash === null) {
    throw new AppError(
      409,
      'PIN_NOT_SET',
      'No tienes un PIN configurado. Ingresa de nuevo con tu contraseña.',
    );
  }

  if (!(await verifySecret(user.pinHash, pin))) {
    const updated = await SessionModel.findOneAndUpdate(
      { _id: auth.session._id, revokedAt: null },
      { $inc: { pinFailedAttempts: 1 } },
      { returnDocument: 'after' },
    );
    const attempts = updated?.pinFailedAttempts ?? AUTH_POLICY.maxPinAttempts;
    const remainingAttempts = Math.max(0, AUTH_POLICY.maxPinAttempts - attempts);
    await recordAudit(
      {
        action: 'AUTH_PIN_FAILED',
        actor: toAuditActor(user),
        entity: sessionEntity(auth.session),
        metadata: { attempts },
        meta,
      },
      deps.logger,
    );

    if (remainingAttempts > 0) return { ok: false, remainingAttempts, sessionClosed: false };

    await revokeSession(auth.session.id, 'PIN_ATTEMPTS');
    await recordAudit(
      {
        action: 'AUTH_SESSION_REVOKED_PIN',
        actor: toAuditActor(user),
        entity: sessionEntity(auth.session),
        meta,
      },
      deps.logger,
    );
    return { ok: false, remainingAttempts: 0, sessionClosed: true };
  }

  const unlocked = await SessionModel.findOneAndUpdate(
    { _id: auth.session._id, revokedAt: null },
    { $set: { lockedAt: null, pinFailedAttempts: 0, lastActivityAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (unlocked === null) throw sessionEnded();
  return { ok: true, issued: await issueAuth(user, unlocked, deps) };
}

// ── Cambio de contraseña y de PIN ──────────────────────────────────

const wrongCurrentPassword = (): AppError =>
  new AppError(400, 'INVALID_CREDENTIALS', 'La contraseña actual no es correcta', [
    { path: 'currentPassword', message: 'La contraseña actual no es correcta' },
  ]);

export async function changePassword(
  auth: AuthContext,
  input: ChangePasswordRequest,
  meta: RequestMeta,
  deps: AuthDeps,
): Promise<AuthSessionResponse> {
  const user = await UserModel.findById(auth.user._id).select('+passwordHash');
  if (user === null) throw sessionEnded();
  if (!(await verifySecret(user.passwordHash, input.currentPassword))) {
    throw wrongCurrentPassword();
  }

  const problem = passwordProblem(input.newPassword, user.username);
  if (problem !== null) {
    throw new AppError(400, 'VALIDATION_ERROR', problem, [
      { path: 'newPassword', message: problem },
    ]);
  }

  user.passwordHash = await hashSecret(input.newPassword);
  user.mustChangePassword = false;
  user.passwordChangedAt = new Date();
  await user.save();

  // Las demás sesiones abiertas (otros dispositivos) se cierran.
  const closed = await revokeUserSessions(user.id, 'PASSWORD_CHANGED', auth.session.id);
  await recordAudit(
    {
      action: 'AUTH_PASSWORD_CHANGED',
      actor: toAuditActor(user),
      entity: userEntity(user),
      metadata: { otherSessionsClosed: closed },
      meta,
    },
    deps.logger,
  );
  return await buildAuthResponse(user, auth.session, deps.config);
}

export async function setPin(
  auth: AuthContext,
  input: SetPinRequest,
  meta: RequestMeta,
  deps: AuthDeps,
): Promise<AuthSessionResponse> {
  const user = await UserModel.findById(auth.user._id).select('+passwordHash +pinHash');
  if (user === null) throw sessionEnded();

  // Cambiar un PIN existente exige la contraseña: evita que alguien lo cambie en una tablet abierta.
  if (user.pinHash !== null) {
    if (input.currentPassword === undefined) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Para cambiar el PIN escribe tu contraseña actual',
        [{ path: 'currentPassword', message: 'Escribe tu contraseña actual' }],
      );
    }
    if (!(await verifySecret(user.passwordHash, input.currentPassword))) {
      throw wrongCurrentPassword();
    }
  }

  user.pinHash = await hashSecret(input.pin);
  user.pinSetAt = new Date();
  await user.save();
  await recordAudit(
    { action: 'AUTH_PIN_SET', actor: toAuditActor(user), entity: userEntity(user), meta },
    deps.logger,
  );
  return await buildAuthResponse(user, auth.session, deps.config);
}
