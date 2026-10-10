import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_ROLE_LABELS,
  USER_ROLES,
  type CreateProfileRequest,
  type Permission,
  type Profile,
  type UpdateProfileRequest,
  type User,
  type UserRole,
} from '@panesypan/shared';
import { mongo } from 'mongoose';
import { AppError } from '../../lib/errors';
import { recordAudit } from '../audit/audit.service';
import { UserModel } from '../users/user.model';
import { toAuditActor, toUserDto } from '../users/users.mapper';
import type { ActorContext } from '../users/users.service';
import { ProfileModel, type ProfileDocument } from './profile.model';

const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);
const profileEntity = (profile: ProfileDocument) => ({
  type: 'PROFILE',
  id: profile.id,
  label: profile.name,
});

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof mongo.MongoServerError && error.code === 11000;
}

/** El perfil "Administrador" siempre tiene todos los permisos y no se modifica. */
const isLockedProfile = (profile: ProfileDocument): boolean => profile.systemRole === 'ADMIN';

export function toProfileDto(profile: ProfileDocument): Profile {
  return {
    id: profile.id,
    name: profile.name,
    permissions: PERMISSIONS.filter((p) => profile.permissions.includes(p)),
    isActive: profile.isActive,
    isSystem: profile.isSystem,
    systemRole: profile.systemRole,
    isEditable: !isLockedProfile(profile),
    createdAt: profile.createdAt.toISOString(),
  };
}

/**
 * Crea los perfiles del sistema si faltan ("Administrador" y "Cajera" con los permisos de
 * siempre). No pisa los cambios que el administrador haya hecho al perfil "Cajera"; el de
 * administrador se vuelve a dejar con todos los permisos.
 */
export async function ensureSystemProfiles(): Promise<void> {
  for (const role of USER_ROLES) {
    try {
      await ProfileModel.updateOne(
        { systemRole: role },
        {
          $setOnInsert: {
            name: USER_ROLE_LABELS[role],
            isSystem: true,
            isActive: true,
            ...(role === 'ADMIN' ? {} : { permissions: [...ROLE_PERMISSIONS[role]] }),
          },
          ...(role === 'ADMIN' ? { $set: { permissions: [...PERMISSIONS] } } : {}),
        },
        { upsert: true },
      );
    } catch (error) {
      // Dos arranques a la vez: el otro ya lo creó.
      if (!isDuplicateKeyError(error)) throw error;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Administración de perfiles

async function findProfileOrThrow(id: string): Promise<ProfileDocument> {
  const profile = await ProfileModel.findById(id);
  if (profile === null) throw new AppError(404, 'NOT_FOUND', 'Perfil no encontrado');
  return profile;
}

export async function listProfiles(): Promise<Profile[]> {
  await ensureSystemProfiles();
  const profiles = await ProfileModel.find().sort({ isSystem: -1, isActive: -1, name: 1 });
  return profiles.map(toProfileDto);
}

export async function createProfile(
  input: CreateProfileRequest & { permissions: Permission[] },
  ctx: ActorContext,
): Promise<Profile> {
  let profile: ProfileDocument;
  try {
    profile = await ProfileModel.create({ name: input.name, permissions: input.permissions });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw conflict('Ya existe un perfil con ese nombre');
    throw error;
  }
  await recordAudit(
    {
      action: 'PROFILE_CREATED',
      actor: toAuditActor(ctx.actor),
      entity: profileEntity(profile),
      metadata: { permissions: profile.permissions },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toProfileDto(profile);
}

export async function updateProfile(
  id: string,
  input: UpdateProfileRequest & { permissions?: Permission[] },
  ctx: ActorContext,
): Promise<Profile> {
  const profile = await findProfileOrThrow(id);
  if (isLockedProfile(profile)) {
    throw conflict('El perfil Administrador siempre tiene todos los permisos y no se modifica');
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (input.name !== undefined && input.name !== profile.name) {
    changes.name = { from: profile.name, to: input.name };
    profile.name = input.name;
  }
  if (input.permissions !== undefined) {
    const before = PERMISSIONS.filter((p) => profile.permissions.includes(p));
    if (before.join(',') !== input.permissions.join(',')) {
      changes.permissions = { from: before, to: input.permissions };
      profile.permissions = input.permissions;
    }
  }
  if (input.isActive !== undefined && input.isActive !== profile.isActive) {
    if (!input.isActive && profile.isSystem) {
      throw conflict('Los perfiles del sistema no se pueden desactivar');
    }
    changes.isActive = { from: profile.isActive, to: input.isActive };
    profile.isActive = input.isActive;
  }

  if (Object.keys(changes).length === 0) return toProfileDto(profile);
  try {
    await profile.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) throw conflict('Ya existe un perfil con ese nombre');
    throw error;
  }
  await recordAudit(
    {
      action: 'PROFILE_UPDATED',
      actor: toAuditActor(ctx.actor),
      entity: profileEntity(profile),
      metadata: { changes },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toProfileDto(profile);
}

/** Asigna un perfil a un usuario (null vuelve al perfil por defecto de su rol). */
export async function setUserProfile(
  userId: string,
  profileId: string | null,
  ctx: ActorContext,
): Promise<User> {
  const user = await UserModel.findById(userId);
  if (user === null) throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado');

  let profile: ProfileDocument | null = null;
  if (profileId !== null) {
    profile = await findProfileOrThrow(profileId);
    if (!profile.isActive) throw conflict('Ese perfil está desactivado');
  }
  const currentId = user.profileId?.toString() ?? null;
  if (currentId === (profile?.id ?? null)) return toUserDto(user);

  const previous = currentId === null ? null : await ProfileModel.findById(currentId);
  user.profileId = profile?._id ?? null;
  await user.save();

  await recordAudit(
    {
      action: 'USER_PROFILE_CHANGED',
      actor: toAuditActor(ctx.actor),
      entity: { type: 'USER', id: user.id, label: user.username },
      metadata: {
        from: previous?.name ?? defaultProfileLabel(user.role),
        to: profile?.name ?? defaultProfileLabel(user.role),
      },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toUserDto(user);
}

const defaultProfileLabel = (role: UserRole): string => `${USER_ROLE_LABELS[role]} (por defecto)`;
