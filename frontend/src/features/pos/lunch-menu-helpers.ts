import type { MenuOption } from '@panesypan/shared';

/** Valor del botón "Sin sopa" / "Sin bebida" (declinar la opción). */
export const NO_CHOICE = '';

/** Si solo hay una opción disponible, se deja elegida. */
export const onlyOption = (options: MenuOption[]): string | null => {
  const available = options.filter((option) => option.isAvailable);
  return available.length === 1 ? (available[0]?.name ?? null) : null;
};

/** Si no hay ninguna opción disponible, no tiene sentido pedir que se elija: queda "Sin ella". */
export const initialChoice = (options: MenuOption[]): string | null =>
  options.some((option) => option.isAvailable) ? onlyOption(options) : NO_CHOICE;
