import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);

describe('csvCell', () => {
  it('deja pasar texto y números simples', () => {
    expect(csvCell('Pan francés')).toBe('Pan francés');
    expect(csvCell(12500)).toBe('12500');
    expect(csvCell(-300)).toBe('-300');
    expect(csvCell(null)).toBe('');
  });

  it('cita las celdas con separador, comillas o saltos de línea', () => {
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvCell(['línea 1', 'línea 2'].join(CRLF))).toBe(`"línea 1${CRLF}línea 2"`);
  });

  it('neutraliza las fórmulas en los textos', () => {
    expect(csvCell('=SUMA(A1:A2)')).toBe("'=SUMA(A1:A2)");
    expect(csvCell('+57 300')).toBe("'+57 300");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@usuario')).toBe("'@usuario");
  });
});

describe('toCsv', () => {
  it('lleva BOM, separador ; y saltos CRLF', () => {
    expect(toCsv(['A', 'B'], [[1, 'x']])).toBe(`${BOM}A;B${CRLF}1;x${CRLF}`);
  });
});
