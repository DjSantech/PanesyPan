export type CsvCell = string | number | null;

/** Excel en es-CO separa las columnas con punto y coma. */
const SEPARATOR = ';';
const LINE_BREAK = '\r\n';
/** Marca de orden de bytes: sin ella Excel abre el UTF-8 con las tildes rotas. */
const BOM = String.fromCharCode(0xfeff);

/** Caracteres con los que Excel interpreta una celda de texto como fórmula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Prepara una celda. Los textos que empiezan como una fórmula se neutralizan con una comilla
 * (inyección de fórmulas: un nombre de producto o una nota no debe ejecutarse al abrir el archivo).
 */
export function csvCell(value: CsvCell): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(SEPARATOR));
  return BOM + lines.join(LINE_BREAK) + LINE_BREAK;
}
