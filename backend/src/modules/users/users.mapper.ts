import { type SessionUser, type User } from '@panesypan/shared';
import { permissionsOf } from '../profiles/effective-permissions';
import type { AuditActor } from '../audit/audit.service';
import type { UserDocument } from './user.model';

export function toUserDto(user: UserDocument, now: Date = new Date()): User {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    profileId: user.profileId?.toString() ?? null,
    isActive: user.isActive,
    hasPin: user.pinSetAt !== null,
    mustChangePassword: user.mustChangePassword,
    lockedUntil:
      user.lockedUntil !== null && user.lockedUntil > now ? user.lockedUntil.toISOString() : null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toSessionUser(user: UserDocument): SessionUser {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    permissions: [...permissionsOf(user)],
    mustChangePassword: user.mustChangePassword,
    hasPin: user.pinSetAt !== null,
  };
}

export function toAuditActor(user: UserDocument): AuditActor {
  return { id: user.id, name: user.name, role: user.role };
}
