import { useSyncExternalStore } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'pyp-theme';
const listeners = new Set<() => void>();

function readStored(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

let current: ThemeMode = typeof window === 'undefined' ? 'system' : readStored();

/** Aplica el tema al <html>: .light / .dark fuerzan el modo; sin clase se sigue al sistema. */
export function applyTheme(mode: ThemeMode): void {
  current = mode;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  if (mode !== 'system') root.classList.add(mode);
  try {
    if (mode === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Sin almacenamiento (navegación privada): el tema dura solo esta visita.
  }
  listeners.forEach((listener) => {
    listener();
  });
}

export function initTheme(): void {
  applyTheme(readStored());
}

export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => 'system',
  );
}
