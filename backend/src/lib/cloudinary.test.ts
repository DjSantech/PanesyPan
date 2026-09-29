import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deliveryUrl, signParams } from './cloudinary';

describe('Cloudinary', () => {
  it('firma con los parámetros ordenados y el secreto al final', () => {
    const expected = createHash('sha1')
      .update('folder=panesypan/productos&timestamp=1700000000secreto')
      .digest('hex');
    expect(signParams({ timestamp: '1700000000', folder: 'panesypan/productos' }, 'secreto')).toBe(
      expected,
    );
  });

  it('entrega con formato y calidad automáticos', () => {
    expect(deliveryUrl('https://res.cloudinary.com/demo/image/upload/v1/p/a.webp')).toBe(
      'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/v1/p/a.webp',
    );
  });
});
