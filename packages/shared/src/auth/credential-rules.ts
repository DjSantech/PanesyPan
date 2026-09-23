import { AUTH_POLICY } from '../constants/auth-policy';
import { removeAccents } from '../text/text';

/** Contraseñas demasiado comunes (se comparan en minúsculas y sin tildes). */
const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '87654321',
  '12341234',
  '11111111',
  '00000000',
  'password',
  'password1',
  'passw0rd',
  'contrasena',
  'contrasena1',
  'qwerty123',
  'qwertyui',
  'asdfghjk',
  'abc12345',
  'abcd1234',
  '1q2w3e4r',
  'iloveyou',
  'admin123',
  'administrador',
  'colombia',
  'colombia1',
  'dosquebradas',
  'pereira123',
  'panadero',
  'panaderia',
  'panesypan',
  'panesypanes',
  'cajera123',
  'bienvenido',
]);

/**
 * Revisa una contraseña nueva. Devuelve el motivo del rechazo o `null` si es válida.
 * Siguiendo a OWASP/NIST: longitud mínima, sin reglas de composición y sin contraseñas comunes.
 */
export function passwordProblem(password: string, username?: string): string | null {
  if (password.length < AUTH_POLICY.passwordMinLength) {
    return `Debe tener al menos ${String(AUTH_POLICY.passwordMinLength)} caracteres`;
  }
  if (password.length > AUTH_POLICY.passwordMaxLength) {
    return `Debe tener máximo ${String(AUTH_POLICY.passwordMaxLength)} caracteres`;
  }
  const normalized = removeAccents(password.toLowerCase());
  if (COMMON_PASSWORDS.has(normalized) || /^(.)\1+$/.test(normalized)) {
    return 'Es demasiado común o fácil de adivinar';
  }
  if (
    username !== undefined &&
    username.length >= 3 &&
    normalized.includes(username.toLowerCase())
  ) {
    return 'No puede contener tu nombre de usuario';
  }
  return null;
}

/**
 * Un PIN es trivial si repite un dígito (000000), sigue una secuencia (123456, 654321)
 * o repite un patrón corto (121212, 123123).
 */
export function isTrivialPin(pin: string): boolean {
  const digits = Array.from(pin, Number);
  const allSame = digits.every((digit) => digit === digits[0]);
  const ascending = digits.every(
    (digit, index) => index === 0 || digit === (digits[index - 1] ?? 0) + 1,
  );
  const descending = digits.every(
    (digit, index) => index === 0 || digit === (digits[index - 1] ?? 0) - 1,
  );
  const repeatsTwo = pin.slice(0, 2).repeat(3) === pin;
  const repeatsThree = pin.slice(0, 3).repeat(2) === pin;
  return allSame || ascending || descending || repeatsTwo || repeatsThree;
}

/** Revisa un PIN nuevo. Devuelve el motivo del rechazo o `null` si es válido. */
export function pinProblem(pin: string): string | null {
  if (!new RegExp(`^\\d{${String(AUTH_POLICY.pinLength)}}$`).test(pin)) {
    return `El PIN debe tener exactamente ${String(AUTH_POLICY.pinLength)} números`;
  }
  if (isTrivialPin(pin)) {
    return 'El PIN es muy fácil de adivinar (evita secuencias y números repetidos)';
  }
  return null;
}
