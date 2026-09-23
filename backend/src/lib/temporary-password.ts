import { randomInt } from 'node:crypto';

/** Sin letras ni números que se confundan al dictarlos o escribirlos (0/o, 1/l/i). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Contraseña temporal fácil de escribir en una tablet: tres bloques de cuatro caracteres
 * (≈ 59 bits de entropía). Ejemplo: "k7mq-x4tn-9hce". Se debe cambiar en el primer ingreso.
 */
export function generateTemporaryPassword(): string {
  const block = (): string =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${block()}-${block()}-${block()}`;
}
