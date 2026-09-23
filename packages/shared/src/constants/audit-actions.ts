/** Acciones que quedan registradas en la auditoría. */
export const AUDIT_ACTIONS = [
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILED',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_LOGOUT',
  'AUTH_LOGOUT_ALL',
  'AUTH_REFRESH_REUSE_DETECTED',
  'AUTH_PIN_FAILED',
  'AUTH_SESSION_REVOKED_PIN',
  'AUTH_PASSWORD_CHANGED',
  'AUTH_PIN_SET',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_ACTIVATED',
  'USER_DEACTIVATED',
  'USER_PASSWORD_RESET',
  'USER_PIN_RESET',
  'USER_UNLOCKED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Readonly<Record<AuditAction, string>> = {
  AUTH_LOGIN_SUCCESS: 'Inicio de sesión',
  AUTH_LOGIN_FAILED: 'Intento de ingreso fallido',
  AUTH_ACCOUNT_LOCKED: 'Cuenta bloqueada por intentos fallidos',
  AUTH_LOGOUT: 'Cierre de sesión',
  AUTH_LOGOUT_ALL: 'Cierre de sesión en todos los dispositivos',
  AUTH_REFRESH_REUSE_DETECTED: 'Posible robo de sesión detectado',
  AUTH_PIN_FAILED: 'PIN incorrecto',
  AUTH_SESSION_REVOKED_PIN: 'Sesión cerrada por intentos de PIN',
  AUTH_PASSWORD_CHANGED: 'Cambio de contraseña',
  AUTH_PIN_SET: 'Cambio de PIN',
  USER_CREATED: 'Usuario creado',
  USER_UPDATED: 'Usuario modificado',
  USER_ACTIVATED: 'Usuario activado',
  USER_DEACTIVATED: 'Usuario desactivado',
  USER_PASSWORD_RESET: 'Contraseña restablecida',
  USER_PIN_RESET: 'PIN restablecido',
  USER_UNLOCKED: 'Cuenta desbloqueada',
};

/** Acciones que conviene resaltar como alertas de seguridad. */
export const SECURITY_ALERT_ACTIONS: readonly AuditAction[] = [
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_REFRESH_REUSE_DETECTED',
  'AUTH_SESSION_REVOKED_PIN',
];
