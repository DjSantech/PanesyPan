import { describe, expect, it } from 'vitest';
import { formatUptime } from './format';

describe('formatUptime', () => {
  it('elige la unidad más útil', () => {
    expect(formatUptime(45)).toBe('45 s');
    expect(formatUptime(12 * 60 + 30)).toBe('12 min');
    expect(formatUptime(3 * 3600 + 12 * 60)).toBe('3 h 12 min');
    expect(formatUptime(2 * 86_400 + 5 * 3600)).toBe('2 d 5 h');
  });

  it('no muestra valores negativos ni decimales', () => {
    expect(formatUptime(-10)).toBe('0 s');
    expect(formatUptime(59.9)).toBe('59 s');
  });
});
