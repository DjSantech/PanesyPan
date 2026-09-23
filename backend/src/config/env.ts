import { z } from 'zod';

/** Convierte cadenas vacías en `undefined` para que los valores opcionales funcionen con `.env`. */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const originListSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
  .pipe(z.array(z.url('Cada origen de CORS_ORIGINS debe ser una URL válida')).min(1))
  .transform((origins) => origins.map((origin) => new URL(origin).origin));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MONGODB_URI: z
    .string('MONGODB_URI es obligatorio')
    .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI debe iniciar con mongodb:// o mongodb+srv://'),
  MONGODB_DB_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,38}$/, 'MONGODB_DB_NAME solo admite letras, números, _ y -')
    .default('panesypan'),

  CORS_ORIGINS: originListSchema.default(['http://localhost:5173']),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  ORIGIN_VERIFY_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(32, 'ORIGIN_VERIFY_SECRET debe tener al menos 32 caracteres').optional(),
  ),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),

  // Render inyecta automáticamente el commit desplegado.
  RENDER_GIT_COMMIT: z.preprocess(emptyToUndefined, z.string().optional()),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

/**
 * Valida las variables de entorno. Nunca incluye los valores en los mensajes de error,
 * solo el nombre de la variable y el problema.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      `Variables de entorno inválidas:\n${z.prettifyError(result.error)}`,
    );
  }

  const env = result.data;
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (emptyToUndefined(source.CORS_ORIGINS) === undefined) {
      problems.push('CORS_ORIGINS es obligatorio en producción');
    } else if (env.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
      problems.push('En producción todos los orígenes de CORS_ORIGINS deben usar https://');
    }
    if (env.ORIGIN_VERIFY_SECRET === undefined) {
      problems.push('ORIGIN_VERIFY_SECRET es obligatorio en producción (ver README, Cloudflare)');
    }
    if (problems.length > 0) {
      throw new EnvValidationError(
        `Configuración de producción incompleta:\n- ${problems.join('\n- ')}`,
      );
    }
  }

  return env;
}
