/** Utilidades compartidas por los scripts que cargan datos de otro sistema. */

/** Lector de CSV (RFC 4180): comillas dobles, comas y saltos de línea dentro de un campo. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\p{Cf}/u, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i] ?? '';
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header = [], ...body] = rows;
  return body.map((values) =>
    Object.fromEntries(header.map((name, index) => [name.trim(), (values[index] ?? '').trim()])),
  );
}

// ── Limpieza de datos ──────────────────────────────────────────────

/** Palabras que van siempre en minúscula (conectores y unidades de medida). */
const LOWER = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'con', 'en', 'sin', 'por', 'para', 'a', 'o', 'al',
  'x', 'ml', 'g', 'kg', 'gr', 'lt', 'l', 'cc', 'und', 'unid', 'unidad', 'oz',
]); // prettier-ignore
/** Siglas que se dejan en mayúscula. */
const UPPER = new Set(['bbq', 'pet', 'uht', 'tr', 'pq', 'led', 'tv', 'usb']);

/** "COCA COLA SIN AZUCAR X 400 ML" → "Coca Cola sin Azucar x 400 ml". */
export function tidyName(raw: string): string {
  const words = raw.replace(/\s+/g, ' ').trim().split(' ');
  const out = words.map((word, index) => {
    const lower = word.toLowerCase();
    if (UPPER.has(lower)) return word.toUpperCase();
    // Medidas pegadas ("500ML", "1.5L") en minúscula; el resto con números ("7UP") tal cual.
    if (/^\d+([.,]\d+)?(ml|g|kg|gr|lt|l|cc|oz|und)$/.test(lower)) return lower;
    if (/\d/.test(word)) return word;
    if (index > 0 && LOWER.has(lower)) return lower;
    return lower.replace(/^\p{L}/u, (c) => c.toUpperCase());
  });
  return out.join(' ');
}
