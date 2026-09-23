/**
 * Quita tildes y diéresis: "Almojábana Güera" → "Almojabana Guera".
 * Separa cada letra de su tilde (NFD) y elimina las marcas combinantes (\p{M}).
 */
export function removeAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}
