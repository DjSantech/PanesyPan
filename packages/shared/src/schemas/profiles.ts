import { z } from 'zod';
import { PERMISSIONS } from '../constants/permissions';
import { USER_ROLES } from '../constants/roles';

/** Perfil de permisos: qué puede hacer quien lo tenga asignado. */
export const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(z.enum(PERMISSIONS)),
  isActive: z.boolean(),
  isSystem: z.boolean(),
  /** Rol al que corresponde por defecto (solo los perfiles del sistema). */
  systemRole: z.enum(USER_ROLES).nullable(),
  /** El perfil "Administrador" no se puede modificar. */
  isEditable: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type Profile = z.infer<typeof profileSchema>;

const profileNameSchema = z
  .string()
  .trim()
  .min(2, 'El nombre debe tener al menos 2 caracteres')
  .max(40, 'El nombre es muy largo');

const permissionListSchema = z
  .array(z.enum(PERMISSIONS))
  .max(PERMISSIONS.length)
  .transform((list) => PERMISSIONS.filter((p) => list.includes(p)));

export const createProfileRequestSchema = z.strictObject({
  name: profileNameSchema,
  permissions: permissionListSchema,
});
export type CreateProfileRequest = z.input<typeof createProfileRequestSchema>;

export const updateProfileRequestSchema = z
  .strictObject({
    name: profileNameSchema.optional(),
    permissions: permissionListSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No hay cambios para guardar' });
export type UpdateProfileRequest = z.input<typeof updateProfileRequestSchema>;

export const listProfilesResponseSchema = z.object({ items: z.array(profileSchema) });
export const profileResponseSchema = z.object({ profile: profileSchema });

/** null vuelve al perfil por defecto de su rol. */
export const setUserProfileRequestSchema = z.strictObject({
  profileId: z
    .string()
    .regex(/^[a-f\d]{24}$/i, 'Perfil inválido')
    .nullable(),
});
export type SetUserProfileRequest = z.infer<typeof setUserProfileRequestSchema>;
