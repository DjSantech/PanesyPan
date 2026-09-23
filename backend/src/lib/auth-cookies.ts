import type { CookieOptions, Request, Response } from 'express';
import { AUTH_POLICY } from '@panesypan/shared';

/**
 * Cookies de sesión, solo para api.panesypan.com (sin atributo Domain).
 * - En producción usan los prefijos __Host- / __Secure-, que el navegador solo acepta con Secure
 *   y que impiden que otro subdominio las sobrescriba.
 * - El token de refresco solo viaja a /api/v1/auth, no en cada petición.
 */
const REFRESH_PATH = '/api/v1/auth';

export interface AuthCookieConfig {
  secure: boolean;
}

export function cookieNames(config: AuthCookieConfig): { access: string; refresh: string } {
  return config.secure
    ? { access: '__Host-pyp_at', refresh: '__Secure-pyp_rt' }
    : { access: 'pyp_at', refresh: 'pyp_rt' };
}

function baseOptions(config: AuthCookieConfig): CookieOptions {
  return { httpOnly: true, secure: config.secure, sameSite: 'lax' };
}

export function setAuthCookies(
  res: Response,
  config: AuthCookieConfig,
  tokens: { accessToken: string; refreshToken?: string; sessionExpiresAt: Date },
): void {
  const names = cookieNames(config);
  res.cookie(names.access, tokens.accessToken, {
    ...baseOptions(config),
    path: '/',
    maxAge: AUTH_POLICY.accessTokenMinutes * 60_000,
  });
  if (tokens.refreshToken !== undefined) {
    res.cookie(names.refresh, tokens.refreshToken, {
      ...baseOptions(config),
      path: REFRESH_PATH,
      expires: tokens.sessionExpiresAt,
    });
  }
}

export function clearAuthCookies(res: Response, config: AuthCookieConfig): void {
  const names = cookieNames(config);
  res.clearCookie(names.access, { ...baseOptions(config), path: '/' });
  res.clearCookie(names.refresh, { ...baseOptions(config), path: REFRESH_PATH });
}

function readCookie(req: Request, name: string): string | undefined {
  const cookies: unknown = req.cookies;
  if (cookies === null || typeof cookies !== 'object') return undefined;
  const value = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readAccessToken(req: Request, config: AuthCookieConfig): string | undefined {
  return readCookie(req, cookieNames(config).access);
}

export function readRefreshToken(req: Request, config: AuthCookieConfig): string | undefined {
  return readCookie(req, cookieNames(config).refresh);
}
