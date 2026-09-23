import { AUTH_POLICY, SESSION_MAX_HOURS, type UserRole } from '@panesypan/shared';
import { trusted, Types } from 'mongoose';
import type { RequestMeta } from '../../lib/request-meta';
import { generateRefreshToken, hashToken } from '../../lib/tokens';
import { SessionModel, type SessionDocument, type SessionRevokeReason } from './session.model';

const IDLE_LOCK_MS = AUTH_POLICY.idleLockMinutes * 60_000;

/** Bloqueada si la bloquearon explícitamente o si lleva más tiempo sin uso del permitido. */
export function isSessionLocked(session: SessionDocument, now: Date = new Date()): boolean {
  return (
    session.lockedAt !== null || now.getTime() - session.lastActivityAt.getTime() > IDLE_LOCK_MS
  );
}

export function isSessionUsable(session: SessionDocument, now: Date = new Date()): boolean {
  return session.revokedAt === null && session.expiresAt > now;
}

export async function createSession(
  userId: string,
  role: UserRole,
  meta: RequestMeta,
  now: Date = new Date(),
): Promise<{ session: SessionDocument; refreshToken: string }> {
  const refreshToken = generateRefreshToken();
  const session = await SessionModel.create({
    userId: new Types.ObjectId(userId),
    tokenHash: hashToken(refreshToken),
    previousTokenHashes: [],
    rotatedAt: now,
    expiresAt: new Date(now.getTime() + SESSION_MAX_HOURS[role] * 3_600_000),
    lastActivityAt: now,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return { session, refreshToken };
}

export async function revokeSession(sessionId: string, reason: SessionRevokeReason): Promise<void> {
  await SessionModel.updateOne(
    { _id: new Types.ObjectId(sessionId), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}

/** Cierra todas las sesiones de un usuario (opcionalmente menos la actual). */
export async function revokeUserSessions(
  userId: string,
  reason: SessionRevokeReason,
  exceptSessionId?: string,
): Promise<number> {
  const filter =
    exceptSessionId === undefined
      ? { userId: new Types.ObjectId(userId), revokedAt: null }
      : {
          userId: new Types.ObjectId(userId),
          revokedAt: null,
          _id: trusted({ $ne: new Types.ObjectId(exceptSessionId) }),
        };
  const result = await SessionModel.updateMany(filter, {
    $set: { revokedAt: new Date(), revokedReason: reason },
  });
  return result.modifiedCount;
}
