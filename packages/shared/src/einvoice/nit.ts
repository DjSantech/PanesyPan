/** Pesos de la DIAN para el dígito de verificación, del dígito menos significativo al más. */
const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const;

/** Deja solo los números de un NIT o documento escrito con puntos, guiones o espacios. */
export const onlyDigits = (value: string): string => value.replace(/\D/g, '');

/**
 * Dígito de verificación (DV) de un NIT según el algoritmo de la DIAN (módulo 11).
 * Recibe el NIT sin el DV. Devuelve null si no es un número válido de hasta 15 dígitos.
 */
export function nitCheckDigit(nit: string): number | null {
  if (!/^\d{1,15}$/.test(nit)) return null;
  let sum = 0;
  for (let index = 0; index < nit.length; index += 1) {
    const digit = Number(nit.charAt(nit.length - 1 - index));
    sum += digit * (NIT_WEIGHTS[index] ?? 0);
  }
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : remainder;
}
