import type { UserRole } from './roles';

/** Reglas de autenticación compartidas por la API y el frontend. */
export const AUTH_POLICY = {
  passwordMinLength: 8,
  passwordMaxLength: 128,
  pinLength: 6,
  /** Intentos fallidos de contraseña antes de bloquear la cuenta. */
  maxLoginAttempts: 5,
  loginLockMinutes: 15,
  /** Intentos fallidos de PIN antes de cerrar la sesión (hay que volver a entrar con contraseña). */
  maxPinAttempts: 5,
  /** Minutos sin uso antes de que la pantalla se bloquee y pida el PIN. */
  idleLockMinutes: 10,
  accessTokenMinutes: 10,
} as const;

/** Duración máxima de una sesión según el rol (después hay que volver a escribir la contraseña). */
export const SESSION_MAX_HOURS: Readonly<Record<UserRole, number>> = {
  CASHIER: 16, // un turno largo
  ADMIN: 24 * 30, // el celular del administrador
};
