import { describe, expect, it } from 'vitest';
import { removeAccents } from './text';

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
