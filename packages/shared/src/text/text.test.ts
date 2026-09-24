import { describe, expect, it } from 'vitest';
import { removeAccents, slugify } from './text';

describe('removeAccents', () => {
  it('quita tildes, diéresis y virgulillas', () => {
    expect(removeAccents('Almojábana Güera')).toBe('Almojabana Guera');
    expect(removeAccents('ÁÉÍÓÚ áéíóú')).toBe('AEIOU aeiou');
    expect(removeAccents('Buñuelo')).toBe('Bunuelo');
  });

  it('no cambia texto sin tildes', () => {
    expect(removeAccents('pan de bono 2026')).toBe('pan de bono 2026');
  });
});

describe('slugify', () => {
  it('genera identificadores legibles', () => {
    expect(slugify('Pan de Bono (grande)')).toBe('pan-de-bono-grande');
    expect(slugify('  Pañuelos  ')).toBe('panuelos');
    expect(slugify('Pan 3 Quesos')).toBe('pan-3-quesos');
    expect(slugify('Jamón & Queso')).toBe('jamon-queso');
  });
});
