import type { BrowserContextOptions } from '@playwright/test';
import { WEB_ORIGIN } from '../../fixtures/env';

/** Formato vertical de celular: pantalla de 405 × 720 px que se graba a 1080 × 1920. */
export const VIEWPORT = { width: 405, height: 720 } as const;
export const VIDEO_SIZE = { width: 1080, height: 1920 } as const;
export const DEVICE_SCALE = VIDEO_SIZE.width / VIEWPORT.width;
export const FPS = 30;

/** Voz de los videos (Windows OneCore) y su velocidad. */
export const VOICE = { voice: 'Sabina', rate: 1.05 } as const;

/** Dirección que se muestra en las portadas. */
export const SYSTEM_URL = 'sistema.panesypan.com';

/** Celular táctil en vertical, en español de Colombia y tema claro. */
export const PHONE: BrowserContextOptions = {
  viewport: VIEWPORT,
  deviceScaleFactor: DEVICE_SCALE,
  isMobile: true,
  hasTouch: true,
  baseURL: WEB_ORIGIN,
  locale: 'es-CO',
  timezoneId: 'America/Bogota',
  colorScheme: 'light',
};
