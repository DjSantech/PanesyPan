/** Escapa un texto para usarlo como búsqueda literal dentro de una expresión regular. */
export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
