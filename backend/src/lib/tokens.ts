import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AUTH_POLICY, USER_ROLES, type UserRole } from '@panesypan/shared';
import { jwtVerify, SignJWT } from 'jose';

const ISSUER = 'panesypan-api';
const AUDIENCE = 'panesypan-staff';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
  role: UserRole;
}

const encodeKey = (secret: string): Uint8Array => new TextEncoder().encode(secret);

/** Token de acceso corto (JWT HS256). La autoridad real es la sesión en la base de datos. */
export async function createAccessToken(
  claims: AccessTokenClaims,
  secret: string,
): Promise<string> {
  return new SignJWT({ sid: claims.sessionId, role: claims.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${String(AUTH_POLICY.accessTokenMinutes)}m`)
    .sign(encodeKey(secret));
}

/** Verifica firma, emisor, audiencia y vencimiento. Devuelve `null` si el token no es válido. */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, encodeKey(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
    const { sub, sid, role } = payload;
    if (
      typeof sub !== 'string' ||
      typeof sid !== 'string' ||
      typeof role !== 'string' ||
      !(USER_ROLES as readonly string[]).includes(role)
    ) {
      return null;
    }
    return { userId: sub, sessionId: sid, role: role as UserRole };
  } catch {
    return null;
  }
}

/** Token de refresco opaco (256 bits aleatorios). En la base de datos solo se guarda su hash. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Token anti-CSRF ligado a la sesión: HMAC(sessionId). No hace falta guardarlo. */
export function createCsrfToken(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:${sessionId}`).digest('base64url');
}

export function isValidCsrfToken(
  token: string | undefined,
  sessionId: string,
  secret: string,
): boolean {
  if (token === undefined || token.length === 0) return false;
  const expected = Buffer.from(createCsrfToken(sessionId, secret));
  const provided = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
