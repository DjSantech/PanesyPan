/** Ancho útil impreso: el papel de 80 mm imprime ~72 mm y el de 58 mm ~48 mm. */
export const PRINTABLE_WIDTH_MM = { '80': 72, '58': 48 } as const;

export const formatSaleNumber = (value: number | null): string =>
  value === null ? '—' : String(value).padStart(6, '0');
