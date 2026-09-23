import { describe, expect, it } from 'vitest';
import { findUnsafeKey } from './reject-unsafe-keys';

describe('findUnsafeKey', () => {
  it('no marca datos normales', () => {
    expect(findUnsafeKey({ name: 'Pandebono', price: 2_000, tags: ['caliente'] })).toBeNull();
    expect(findUnsafeKey(null)).toBeNull();
    expect(findUnsafeKey('texto con $ y .')).toBeNull();
  });

  it('detecta operadores de MongoDB en cualquier nivel', () => {
    expect(findUnsafeKey({ $where: 'sleep(1000)' })).toBe('$where');
    expect(findUnsafeKey({ a: { b: [{ c: { $gt: 1 } }] } })).toBe('$gt');
  });

  it('detecta claves con punto y claves de prototipo', () => {
    expect(findUnsafeKey({ 'user.role': 'ADMIN' })).toBe('user.role');
    expect(findUnsafeKey(JSON.parse('{"__proto__": {"x": 1}}'))).toBe('__proto__');
    expect(findUnsafeKey({ constructor: { prototype: {} } })).toBe('constructor');
  });

  it('corta estructuras demasiado profundas', () => {
    let deep: unknown = 'fin';
    for (let level = 0; level < 40; level += 1) deep = { next: deep };
    expect(findUnsafeKey(deep)).not.toBeNull();
  });
});
