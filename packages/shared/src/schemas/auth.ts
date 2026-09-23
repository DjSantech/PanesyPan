import { z } from 'zod';
import { passwordProblem, pinProblem } from '../auth/credential-rules';
import { AUTH_POLICY } from '../constants/auth-policy';
import { PERMISSIONS } from '../constants/permissions';
import { USER_ROLES } from '../constants/roles';

/** Usuario: 3 a 32 caracteres, minúsculas, números, punto, guion o guion bajo. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$/,
    'El usuario debe tener de 3 a 32 caracteres: letras sin tildes, números, punto o guion',
  );

export const personNameSchema = z
  .string()
  .trim()
  .min(2, 'El nombre debe tener al menos 2 caracteres')
  .max(80, 'El nombre debe tener máximo 80 caracteres');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Correo electrónico inválido').max(254));

/** Contraseña nueva: aplica la política completa. */
export const newPasswordSchema = z.string().superRefine((value, context) => {
  const problem = passwordProblem(value);
  if (problem !== null) context.addIssue({ code: 'custom', message: problem });
});

/** PIN nuevo de 6 dígitos no trivial. */
export const newPinSchema = z.string().superRefine((value, context) => {
  const problem = pinProblem(value);
  if (problem !== null) context.addIssue({ code: 'custom', message: problem });
});

// ── Peticiones ─────────────────────────────────────────────────────

export const loginRequestSchema = z.strictObject({
  /** Usuario o correo. */
  identifier: z.string().trim().toLowerCase().min(1, 'Escribe tu usuario').max(254),
  password: z.string().min(1, 'Escribe tu contraseña').max(AUTH_POLICY.passwordMaxLength),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z
  .strictObject({
    currentPassword: z
      .string()
      .min(1, 'Escribe tu contraseña actual')
      .max(AUTH_POLICY.passwordMaxLength),
    newPassword: newPasswordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'La nueva contraseña debe ser diferente a la actual',
    path: ['newPassword'],
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const setPinRequestSchema = z.strictObject({
  pin: newPinSchema,
  /** Obligatoria solo si el usuario ya tenía un PIN. */
  currentPassword: z.string().min(1).max(AUTH_POLICY.passwordMaxLength).optional(),
});
export type SetPinRequest = z.infer<typeof setPinRequestSchema>;

export const unlockRequestSchema = z.strictObject({
  pin: z.string().regex(/^\d{6}$/, 'El PIN tiene 6 números'),
});
export type UnlockRequest = z.infer<typeof unlockRequestSchema>;

// ── Respuestas ─────────────────────────────────────────────────────

export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  email: z.string().nullable(),
  role: z.enum(USER_ROLES),
  permissions: z.array(z.enum(PERMISSIONS)),
  mustChangePassword: z.boolean(),
  hasPin: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const authSessionResponseSchema = z.object({
  user: sessionUserSchema,
  /** Token anti-CSRF: se envía en el header X-CSRF-Token en cada POST/PUT/PATCH/DELETE. */
  csrfToken: z.string(),
  session: z.object({
    locked: z.boolean(),
    expiresAt: z.iso.datetime(),
    idleLockMinutes: z.int().positive(),
  }),
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
