import { z } from 'zod';
import { USER_ROLES } from '../constants/roles';
import { emailSchema, personNameSchema, usernameSchema } from './auth';

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  role: z.enum(USER_ROLES),
  isActive: z.boolean(),
  hasPin: z.boolean(),
  mustChangePassword: z.boolean(),
  lockedUntil: z.iso.datetime().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type User = z.infer<typeof userSchema>;

export const listUsersQuerySchema = z.strictObject({
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  role: z.enum(USER_ROLES).optional(),
  search: z.string().trim().max(60).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const listUsersResponseSchema = z.object({ items: z.array(userSchema) });

export const createUserRequestSchema = z.strictObject({
  name: personNameSchema,
  username: usernameSchema,
  email: emailSchema.optional(),
  role: z.enum(USER_ROLES),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .strictObject({
    name: personNameSchema.optional(),
    email: emailSchema.nullable().optional(),
    role: z.enum(USER_ROLES).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No hay cambios para guardar' });
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const setUserStatusRequestSchema = z.strictObject({ isActive: z.boolean() });
export type SetUserStatusRequest = z.infer<typeof setUserStatusRequestSchema>;

/** La contraseña temporal solo se muestra una vez, en esta respuesta. */
export const userWithTemporaryPasswordSchema = z.object({
  user: userSchema,
  temporaryPassword: z.string(),
});
export type UserWithTemporaryPassword = z.infer<typeof userWithTemporaryPasswordSchema>;

export const userResponseSchema = z.object({ user: userSchema });
