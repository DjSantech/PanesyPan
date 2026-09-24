/**
 * Quita tildes y diéresis: "Almojábana Güera" → "Almojabana Guera".
 * Separa cada letra de su tilde (NFD) y elimina las marcas combinantes (\p{M}).
 */
export function removeAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

/**
 * Identificador legible para URLs y búsquedas: "Pan de Bono (grande)" → "pan-de-bono-grande".
 */
export function slugify(value: string): string {
  return removeAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
