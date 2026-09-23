import { describe, expect, it } from 'vitest';
import { businessDateSchema, moneySchema, objectIdSchema } from './common';
import { databaseHealthResponseSchema } from './health';

describe('esquemas comunes', () => {
  it('moneySchema solo acepta enteros no negativos', () => {
    expect(moneySchema.safeParse(12_500).success).toBe(true);
    expect(moneySchema.safeParse(0).success).toBe(true);
    expect(moneySchema.safeParse(12_500.5).success).toBe(false);
    expect(moneySchema.safeParse(-100).success).toBe(false);
    expect(moneySchema.safeParse('12500').success).toBe(false);
  });

  it('objectIdSchema valida ObjectId de 24 caracteres hexadecimales', () => {
    expect(objectIdSchema.safeParse('66f1a2b3c4d5e6f708192a3b').success).toBe(true);
    expect(objectIdSchema.safeParse('66f1a2b3').success).toBe(false);
    expect(objectIdSchema.safeParse({ $ne: null }).success).toBe(false);
  });

  it('businessDateSchema valida AAAA-MM-DD', () => {
    expect(businessDateSchema.safeParse('2026-09-23').success).toBe(true);
    expect(businessDateSchema.safeParse('2026-9-23').success).toBe(false);
  });
});

describe('databaseHealthResponseSchema', () => {
  it('acepta estado arriba y abajo', () => {
    expect(
      databaseHealthResponseSchema.safeParse({ status: 'ok', database: 'up', latencyMs: 3 })
        .success,
    ).toBe(true);
    expect(
      databaseHealthResponseSchema.safeParse({ status: 'error', database: 'down' }).success,
    ).toBe(true);
    expect(databaseHealthResponseSchema.safeParse({ status: 'ok', database: 'down' }).success).toBe(
      false,
    );
  });
});
