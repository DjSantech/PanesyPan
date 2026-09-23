/** Códigos de error estables que devuelve la API (el mensaje puede cambiar, el código no). */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'INVALID_JSON',
  'INVALID_INPUT',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_DISABLED',
  'SESSION_LOCKED',
  'PASSWORD_CHANGE_REQUIRED',
  'PIN_NOT_SET',
  'INVALID_PIN',
  'CSRF_INVALID',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
