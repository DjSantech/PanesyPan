import {
  authSessionResponseSchema,
  type AuthSessionResponse,
  type ChangePasswordRequest,
  type LoginRequest,
  type SetPinRequest,
} from '@panesypan/shared';
import {
  apiJson,
  apiRequest,
  apiVoid,
  applySession,
  clearSession,
  toApiError,
} from '@/lib/api-client';
import { queryClient } from '@/lib/query-client';
import { useSessionStore } from '@/stores/session.store';

/** Sesión actual, o `null` si no hay nadie ingresado. */
export async function fetchSession(signal?: AbortSignal): Promise<AuthSessionResponse | null> {
  const { status, body, requestId } = await apiRequest('/api/v1/auth/me', { signal });
  if (status === 401) return null;
  if (status !== 200) throw toApiError(status, body, requestId);
  const auth = authSessionResponseSchema.parse(body);
  useSessionStore.getState().applyAuth(auth);
  return auth;
}

export async function login(input: LoginRequest): Promise<AuthSessionResponse> {
  const auth = await apiJson('/api/v1/auth/login', authSessionResponseSchema, {
    method: 'POST',
    body: input,
    skipRefresh: true,
  });
  queryClient.clear();
  applySession(auth);
  return auth;
}

/** Cierra la sesión. Aunque el servidor no responda, la sesión local se olvida. */
export async function logout(): Promise<void> {
  try {
    await apiRequest('/api/v1/auth/logout', { method: 'POST', skipRefresh: true });
  } finally {
    queryClient.clear();
    clearSession();
  }
}

export async function logoutEverywhere(): Promise<void> {
  await apiVoid('/api/v1/auth/logout-all', { method: 'POST' });
  queryClient.clear();
  clearSession();
}

/** Bloquea la pantalla. Se bloquea localmente aunque la petición falle (sin internet, etc.). */
export async function lockSession(): Promise<void> {
  useSessionStore.getState().setLocked(true);
  try {
    await apiVoid('/api/v1/auth/lock', { method: 'POST' });
  } catch {
    // El servidor también la bloquea por inactividad; desbloquear exige el PIN igualmente.
  }
}

export type UnlockOutcome =
  | { status: 'unlocked' }
  | { status: 'wrong-pin'; message: string }
  | { status: 'signed-out'; message: string }
  | { status: 'no-pin'; message: string };

export async function unlockSession(pin: string): Promise<UnlockOutcome> {
  const { status, body, requestId } = await apiRequest('/api/v1/auth/unlock', {
    method: 'POST',
    body: { pin },
  });
  if (status === 200) {
    applySession(authSessionResponseSchema.parse(body));
    return { status: 'unlocked' };
  }
  const error = toApiError(status, body, requestId);
  if (error.code === 'INVALID_PIN') return { status: 'wrong-pin', message: error.message };
  if (error.code === 'PIN_NOT_SET') return { status: 'no-pin', message: error.message };
  if (error.code === 'UNAUTHORIZED') {
    queryClient.clear();
    clearSession();
    return { status: 'signed-out', message: error.message };
  }
  throw error;
}

export async function changePassword(input: ChangePasswordRequest): Promise<AuthSessionResponse> {
  const auth = await apiJson('/api/v1/auth/change-password', authSessionResponseSchema, {
    method: 'POST',
    body: input,
  });
  applySession(auth);
  return auth;
}

export async function setPin(input: SetPinRequest): Promise<AuthSessionResponse> {
  const auth = await apiJson('/api/v1/auth/pin', authSessionResponseSchema, {
    method: 'PUT',
    body: input,
  });
  applySession(auth);
  return auth;
}

/** Marca actividad en el servidor (evita el bloqueo mientras la persona está usando la pantalla). */
export async function touchSession(): Promise<void> {
  const { status, body } = await apiRequest('/api/v1/auth/me');
  if (status === 200) {
    const parsed = authSessionResponseSchema.safeParse(body);
    if (parsed.success) applySession(parsed.data);
  }
}
