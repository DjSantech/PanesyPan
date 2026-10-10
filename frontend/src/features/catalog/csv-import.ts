import { removeAccents, type ProductImportRow } from '@panesypan/shared';

/** Marca de orden de bytes con la que Excel guarda los CSV en UTF-8. */
const BOM = String.fromCharCode(0xfeff);

/** Separa un CSV en filas y celdas (comillas dobles, ; o , o tabulador según el encabezado). */
export function parseCsv(text: string): string[][] {
  const clean = text.startsWith(BOM) ? text.slice(1) : text;
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const separator = [';', '\t', ','].reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean.charAt(index);
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

/**
 * Convierte un valor en pesos escrito de cualquier forma ("$ 1.791", "1791,50", "2,800") a
 * entero. Devuelve undefined si la celda está vacía o no es un número.
 */
export function parseMoney(value: string): number | undefined {
  const text = value.replace(/[^\d.,-]/g, '');
  if (text === '' || text === '-') return undefined;
  let normalized: string;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  const decimalAt = Math.max(lastComma, lastDot);
  // Un separador con 1 o 2 dígitos al final es de decimales; con 3, de miles.
  if (decimalAt >= 0 && text.length - decimalAt - 1 <= 2) {
    normalized = `${text.slice(0, decimalAt).replace(/[.,]/g, '')}.${text.slice(decimalAt + 1)}`;
  } else {
    normalized = text.replace(/[.,]/g, '');
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number) : undefined;
}

const key = (header: string) => removeAccents(header).toLowerCase().trim();

/**
 * Columna de cada dato según el título (sirve con el archivo exportado y con el de TryTiendas).
 * Los nombres van en orden de preferencia: "Precio de venta" gana sobre otro "Precio", y el
 * último costo o costo unitario sobre el costo promedio.
 */
function columnsOf(headers: readonly string[]) {
  const keys = headers.map(key);
  const find = (...names: string[]) => {
    for (const name of names) {
      const index = keys.findIndex((header) => header.includes(name));
      if (index >= 0) return index;
    }
    return -1;
  };
  const price = find('precio de venta', 'precio venta', 'precio_venta', 'precio');
  const costCandidates = [
    'ultimo costo',
    'costo unitario',
    'costo_unitario',
    'costo',
    'precio de compra',
    'precio compra',
  ];
  return {
    code: find('codigo de barras', 'codigo_barras', 'barras', 'codigo', 'code', 'sku'),
    name: find('nombre', 'producto', 'descripcion'),
    category: keys.findIndex((header) => header.startsWith('categoria')),
    subcategory: find('subcategoria'),
    price,
    // El costo nunca sale de la misma columna del precio de venta.
    cost: (() => {
      const index = find(...costCandidates);
      return index === price ? -1 : index;
    })(),
    minStock: find('minimo'),
  };
}

/** Quita la comilla con la que el exporte protege los textos que empiezan como fórmula. */
const text = (value: string | undefined) => (value ?? '').trim().replace(/^'(?=[=+\-@])/, '');

/** Filas del CSV listas para la carga masiva (sin títulos y sin filas sin nombre). */
export function productRowsFromCsv(content: string): {
  rows: ProductImportRow[];
  missingName: boolean;
} {
  const [headers = [], ...lines] = parseCsv(content);
  const columns = columnsOf(headers);
  if (columns.name < 0) return { rows: [], missingName: true };
  const cell = (line: string[], index: number) => (index < 0 ? '' : text(line[index]));
  const rows = lines.flatMap((line): ProductImportRow[] => {
    const name = cell(line, columns.name);
    if (name === '') return [];
    const row: ProductImportRow = { name, category: cell(line, columns.category) };
    const code = cell(line, columns.code);
    if (code !== '') row.code = code;
    const price = parseMoney(cell(line, columns.price));
    const cost = parseMoney(cell(line, columns.cost));
    const minStock = parseMoney(cell(line, columns.minStock));
    if (columns.subcategory >= 0) row.subcategory = cell(line, columns.subcategory);
    if (price !== undefined) row.price = price;
    if (cost !== undefined) row.cost = cost;
    if (minStock !== undefined) row.minStock = minStock;
    return [row];
  });
  return { rows, missingName: false };
}
