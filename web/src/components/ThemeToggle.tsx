'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { THEME_STORAGE_KEY } from '@/lib/theme';
type Theme = 'light' | 'dark';

/** Tema actual según el atributo que dejó el script del layout (claro por defecto). */
const currentTheme = (): Theme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

/** Botón para cambiar entre modo claro y oscuro; recuerda la elección en este navegador. */
export function ThemeToggle() {
  // Hasta montar no se sabe el tema elegido: se muestra el ícono del modo claro.
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se lee el DOM una sola vez al montar
    setTheme(currentTheme());
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Sin almacenamiento (modo privado): el cambio dura hasta recargar.
    }
    setTheme(next);
  };

  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-md p-2 hover:bg-muted"
      aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      aria-pressed={dark}
    >
      {dark ? <Sun aria-hidden className="size-6" /> : <Moon aria-hidden className="size-6" />}
    </button>
  );
}
