import type {
  CreateUserRequest,
  ListUsersQuery,
  UpdateUserRequest,
  User,
  UserWithTemporaryPassword,
} from '@panesypan/shared';
import { mongo, trusted, Types, type QueryFilter } from 'mongoose';
import type { Logger } from 'pino';
import { AppError } from '../../lib/errors';
import { hashSecret } from '../../lib/password';
import type { RequestMeta } from '../../lib/request-meta';
import { generateTemporaryPassword } from '../../lib/temporary-password';
import { recordAudit } from '../audit/audit.service';
import { revokeUserSessions } from '../auth/session.service';
import { UserModel, type UserAttrs, type UserDocument } from './user.model';
import { toAuditActor, toUserDto } from './users.mapper';

/** Quién hace el cambio y desde dónde (para la auditoría). */
export interface ActorContext {
  actor: UserDocument;
  meta: RequestMeta;
  logger?: Logger;
}

const conflict = (message: string): AppError => new AppError(409, 'CONFLICT', message);
const userEntity = (user: UserDocument) => ({ type: 'USER', id: user.id, label: user.username });
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof mongo.MongoServerError && error.code === 11000;
}

async function findUserOrThrow(id: string): Promise<UserDocument> {
  const user = await UserModel.findById(id);
  if (user === null) throw new AppError(404, 'NOT_FOUND', 'Usuario no encontrado');
  return user;
}

async function ensureIdentityAvailable(
  username: string | undefined,
  email: string | null | undefined,
  excludeId?: string,
): Promise<void> {
  const notSelf =
    excludeId === undefined ? {} : { _id: trusted({ $ne: new Types.ObjectId(excludeId) }) };
  if (username !== undefined && (await UserModel.exists({ username, ...notSelf })) !== null) {
    throw conflict('Ya existe un usuario con ese nombre de usuario');
  }
  if (typeof email === 'string' && (await UserModel.exists({ email, ...notSelf })) !== null) {
    throw conflict('Ya existe un usuario con ese correo');
  }
}

/** Impide quedarse sin administradores activos. */
async function ensureAnotherActiveAdmin(excludeId: string): Promise<void> {
  const others = await UserModel.countDocuments({
    role: 'ADMIN',
    isActive: true,
    _id: trusted({ $ne: new Types.ObjectId(excludeId) }),
  });
  if (others === 0) throw conflict('Debe quedar al menos un administrador activo');
}

export async function listUsers(query: ListUsersQuery): Promise<User[]> {
  const filter: QueryFilter<UserAttrs> = {};
  if (query.status !== 'all') filter.isActive = query.status === 'active';
  if (query.role !== undefined) filter.role = query.role;
  if (query.search !== undefined && query.search.length > 0) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: pattern }, { username: pattern }, { email: pattern }];
  }
  const users = await UserModel.find(filter).sort({ isActive: -1, role: 1, name: 1 }).limit(200);
  const now = new Date();
  return users.map((user) => toUserDto(user, now));
}

export async function getUser(id: string): Promise<User> {
  return toUserDto(await findUserOrThrow(id));
}

export async function createUser(
  input: CreateUserRequest,
  ctx: ActorContext,
): Promise<UserWithTemporaryPassword> {
  await ensureIdentityAvailable(input.username, input.email);
  const temporaryPassword = generateTemporaryPassword();

  let user: UserDocument;
  try {
    user = await UserModel.create({
      name: input.name,
      username: input.username,
      email: input.email ?? null,
      role: input.role,
      passwordHash: await hashSecret(temporaryPassword),
      mustChangePassword: true,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) throw conflict('Ya existe un usuario con ese usuario o correo');
    throw error;
  }

  await recordAudit(
    {
      action: 'USER_CREATED',
      actor: toAuditActor(ctx.actor),
      entity: userEntity(user),
      metadata: { role: user.role },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return { user: toUserDto(user), temporaryPassword };
}

export async function updateUser(
  id: string,
  input: UpdateUserRequest,
  ctx: ActorContext,
): Promise<User> {
  const user = await findUserOrThrow(id);
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (input.role !== undefined && input.role !== user.role) {
    if (user.id === ctx.actor.id) throw conflict('No puedes cambiar tu propio rol');
    if (user.role === 'ADMIN' && user.isActive) await ensureAnotherActiveAdmin(user.id);
    changes.role = { from: user.role, to: input.role };
    user.role = input.role;
  }
  if (input.name !== undefined && input.name !== user.name) {
    changes.name = { from: user.name, to: input.name };
    user.name = input.name;
  }
  if (input.email !== undefined && input.email !== user.email) {
    await ensureIdentityAvailable(undefined, input.email, user.id);
    changes.email = { from: user.email, to: input.email };
    user.email = input.email;
  }

  if (Object.keys(changes).length === 0) return toUserDto(user);

  try {
    await user.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) throw conflict('Ya existe un usuario con ese correo');
    throw error;
  }
  await recordAudit(
    {
      action: 'USER_UPDATED',
      actor: toAuditActor(ctx.actor),
      entity: userEntity(user),
      metadata: { changes },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toUserDto(user);
}

export async function setUserStatus(
  id: string,
  isActive: boolean,
  ctx: ActorContext,
): Promise<User> {
  const user = await findUserOrThrow(id);
  if (user.isActive === isActive) return toUserDto(user);

  if (!isActive) {
    if (user.id === ctx.actor.id) throw conflict('No puedes desactivar tu propio usuario');
    if (user.role === 'ADMIN') await ensureAnotherActiveAdmin(user.id);
  }

  user.isActive = isActive;
  await user.save();
  const sessionsClosed = isActive ? 0 : await revokeUserSessions(user.id, 'USER_DEACTIVATED');

  await recordAudit(
    {
      action: isActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      actor: toAuditActor(ctx.actor),
      entity: userEntity(user),
      metadata: isActive ? {} : { sessionsClosed },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toUserDto(user);
}

export async function resetUserPassword(
  id: string,
  ctx: ActorContext,
): Promise<UserWithTemporaryPassword> {
  const user = await findUserOrThrow(id);
  if (user.id === ctx.actor.id) {
    throw conflict('Para cambiar tu propia contraseña usa la opción "Mi cuenta"');
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashSecret(temporaryPassword);
  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordHash,
        mustChangePassword: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        passwordChangedAt: new Date(),
      },
    },
  );
  const sessionsClosed = await revokeUserSessions(user.id, 'PASSWORD_RESET');

  await recordAudit(
    {
      action: 'USER_PASSWORD_RESET',
      actor: toAuditActor(ctx.actor),
      entity: userEntity(user),
      metadata: { sessionsClosed },
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return { user: toUserDto(await findUserOrThrow(id)), temporaryPassword };
}

export async function resetUserPin(id: string, ctx: ActorContext): Promise<User> {
  const user = await findUserOrThrow(id);
  if (user.id === ctx.actor.id)
    throw conflict('Para cambiar tu propio PIN usa la opción "Mi cuenta"');

  await UserModel.updateOne({ _id: user._id }, { $set: { pinHash: null, pinSetAt: null } });
  await recordAudit(
    {
      action: 'USER_PIN_RESET',
      actor: toAuditActor(ctx.actor),
      entity: userEntity(user),
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toUserDto(await findUserOrThrow(id));
}

export async function unlockUser(id: string, ctx: ActorContext): Promise<User> {
  const user = await findUserOrThrow(id);
  user.lockedUntil = null;
  user.failedLoginAttempts = 0;
  await user.save();
  await recordAudit(
    {
      action: 'USER_UNLOCKED',
      actor: toAuditActor(ctx.actor),
      entity: userEntity(user),
      meta: ctx.meta,
    },
    ctx.logger,
  );
  return toUserDto(user);
}
