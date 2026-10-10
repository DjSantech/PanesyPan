import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from '@panesypan/shared';
import type { UserDocument } from '../users/user.model';
import { ProfileModel, type ProfileDocument } from './profile.model';

/** Caché por petición: el documento del usuario vive lo que dura la petición. */
const effectiveCache = new WeakMap<UserDocument, readonly Permission[]>();

/** Permisos efectivos de un usuario, consultando su perfil (o el de su rol si no tiene). */
export async function resolvePermissions(user: UserDocument): Promise<readonly Permission[]> {
  const cached = effectiveCache.get(user);
  if (cached !== undefined) return cached;
  const permissions = await computePermissions(user);
  effectiveCache.set(user, permissions);
  return permissions;
}

async function computePermissions(user: UserDocument): Promise<readonly Permission[]> {
  // Un administrador nunca pierde permisos: así nadie queda por fuera del sistema.
  if (user.role === 'ADMIN') return PERMISSIONS;
  let profile: ProfileDocument | null = null;
  const profileId = user.profileId ?? null;
  if (profileId !== null) profile = await ProfileModel.findById(profileId);
  if (profile?.isActive !== true) profile = await ProfileModel.findOne({ systemRole: user.role });
  if (profile === null) return ROLE_PERMISSIONS[user.role];
  return PERMISSIONS.filter((p) => profile.permissions.includes(p));
}

/**
 * Permisos ya resueltos en esta petición. Si no se resolvieron (no pasó por `authenticate`),
 * se usan los del rol: es el comportamiento de antes de los perfiles.
 */
export function permissionsOf(user: UserDocument): readonly Permission[] {
  return effectiveCache.get(user) ?? ROLE_PERMISSIONS[user.role];
}

export function userCan(user: UserDocument, permission: Permission): boolean {
  return permissionsOf(user).includes(permission);
}
