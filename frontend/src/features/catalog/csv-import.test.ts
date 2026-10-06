import { describe, expect, it } from 'vitest';
import { parseCsv, parseMoney, productRowsFromCsv } from './csv-import';

describe('carga de productos desde CSV', () => {
  it('entiende los precios escritos de varias formas', () => {
    expect(parseMoney('$ 1.791')).toBe(1_791);
    expect(parseMoney('1791,50')).toBe(1_792);
    expect(parseMoney('2,800')).toBe(2_800);
    expect(parseMoney('')).toBeUndefined();
  });

  it('separa por ; con comillas', () => {
    expect(parseCsv('a;b\r\n"Pan; grande";2\r\n')).toEqual([
      ['a', 'b'],
      ['Pan; grande', '2'],
    ]);
  });

  it('arma las filas con los títulos del exporte y de TryTiendas', () => {
    const exported =
      String.fromCharCode(0xfeff) +
      'Nombre;Categoría;Subcategoría;Precio;Costo\r\nPepsi;Bebidas;Gaseosas;2800;1900\r\n';
    expect(productRowsFromCsv(exported).rows).toEqual([
      { name: 'Pepsi', category: 'Bebidas', subcategory: 'Gaseosas', price: 2_800, cost: 1_900 },
    ]);
    const tryTiendas =
      'Código,Nombre,Categoría,Costo,Precio de venta\n770,BIG COLA,Bebidas,"1.791","2.500"\n';
    expect(productRowsFromCsv(tryTiendas).rows).toEqual([
      { name: 'BIG COLA', category: 'Bebidas', price: 2_500, cost: 1_791 },
    ]);
    expect(productRowsFromCsv('Precio\n100\n').missingName).toBe(true);
  });
});
