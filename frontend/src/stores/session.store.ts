import type { AuthSessionResponse } from '@panesypan/shared';
import { create } from 'zustand';

interface SessionState {
  /**
   * Token anti-CSRF. Vive SOLO en memoria (nunca en localStorage): si la página se recarga,
   * se vuelve a pedir a /auth/me.
   */
  csrfToken: string | null;
  /** La pantalla está bloqueada y pide el PIN. */
  locked: boolean;
  idleLockMinutes: number;
  applyAuth: (auth: AuthSessionResponse) => void;
  setLocked: (locked: boolean) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  csrfToken: null,
  locked: false,
  idleLockMinutes: 10,
  applyAuth: (auth) => {
    set({
      csrfToken: auth.csrfToken,
      locked: auth.session.locked,
      idleLockMinutes: auth.session.idleLockMinutes,
    });
  },
  setLocked: (locked) => {
    set({ locked });
  },
  reset: () => {
    set({ csrfToken: null, locked: false });
  },
}));
