import type { Env } from '../../config/env';
import type { AuthCookieConfig } from '../../lib/auth-cookies';

export interface AuthConfig {
  accessTokenSecret: string;
  csrfSecret: string;
  cookies: AuthCookieConfig;
  /** Detrás de Cloudflare (verificación de origen activa) la IP real viene en CF-Connecting-IP. */
  trustCloudflareHeader: boolean;
}

export function authConfigFromEnv(env: Env): AuthConfig {
  return {
    accessTokenSecret: env.JWT_ACCESS_SECRET,
    csrfSecret: env.CSRF_SECRET,
    cookies: { secure: env.NODE_ENV === 'production' },
    trustCloudflareHeader: env.ORIGIN_VERIFY_SECRET !== undefined,
  };
}
