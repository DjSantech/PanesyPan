import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './env';

const BASE = { MONGODB_URI: 'mongodb://127.0.0.1:27017/?replicaSet=rs0' };
const SECRET = 'k'.repeat(40);

describe('loadEnv', () => {
  it('aplica valores por defecto seguros', () => {
    const env = loadEnv(BASE);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.MONGODB_DB_NAME).toBe('panesypan');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.ORIGIN_VERIFY_SECRET).toBeUndefined();
  });

  it('exige MONGODB_URI sin mostrar valores en el error', () => {
    expect(() => loadEnv({})).toThrow(EnvValidationError);
    expect(() => loadEnv({})).toThrow(/MONGODB_URI/);
    expect(() => loadEnv({ MONGODB_URI: 'postgres://user:clave@host/db' })).toThrow(/mongodb:\/\//);
    expect(() => loadEnv({ MONGODB_URI: 'postgres://user:clave@host/db' })).not.toThrow(/clave/);
  });

  it('normaliza la lista de orígenes CORS', () => {
    const env = loadEnv({
      ...BASE,
      CORS_ORIGINS: ' http://localhost:5173 , https://sistema.panesypan.com/ ',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://sistema.panesypan.com']);
  });

  it('trata variables vacías como no definidas y valida el largo del secreto', () => {
    expect(loadEnv({ ...BASE, ORIGIN_VERIFY_SECRET: '' }).ORIGIN_VERIFY_SECRET).toBeUndefined();
    expect(() => loadEnv({ ...BASE, ORIGIN_VERIFY_SECRET: 'corto' })).toThrow(/32 caracteres/);
  });

  describe('en producción', () => {
    const production = {
      ...BASE,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://sistema.panesypan.com',
      ORIGIN_VERIFY_SECRET: SECRET,
    };

    it('acepta una configuración completa', () => {
      expect(() => loadEnv(production)).not.toThrow();
    });

    it('exige CORS_ORIGINS explícito y con https', () => {
      expect(() => loadEnv({ ...production, CORS_ORIGINS: undefined })).toThrow(/CORS_ORIGINS/);
      expect(() =>
        loadEnv({ ...production, CORS_ORIGINS: 'http://sistema.panesypan.com' }),
      ).toThrow(/https/);
    });

    it('exige ORIGIN_VERIFY_SECRET', () => {
      expect(() => loadEnv({ ...production, ORIGIN_VERIFY_SECRET: undefined })).toThrow(
        /ORIGIN_VERIFY_SECRET/,
      );
    });
  });
});
