import { defineConfig } from '@playwright/test';
import { API_URL, WEB_ORIGIN, WEB_PORT } from '../fixtures/env';
import { DEVICE_SCALE } from './lib/format';

/**
 * Videos tutoriales del sistema: Playwright usa el POS como una persona, en un celular, y lo
 * graba con subtítulos y voz. Usa el mismo entorno aislado de las pruebas de punta a punta
 * (base de datos en memoria con el catálogo real). Uso: `pnpm videos` (ver README.md).
 */
export default defineConfig({
  testDir: './videos',
  testMatch: '*.video.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 20 * 60_000,
  reporter: 'list',
  use: {
    baseURL: WEB_ORIGIN,
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    colorScheme: 'light',
    // Chromium pinta a la densidad de un celular: los cuadros salen nítidos a 1080 × 1920.
    launchOptions: { args: [`--force-device-scale-factor=${String(DEVICE_SCALE)}`] },
  },
  webServer: [
    {
      command: 'node --import tsx ../stack.ts',
      url: `${API_URL}/api/health`,
      timeout: 180_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: `pnpm --filter @panesypan/frontend exec vite --port ${String(WEB_PORT)} --strictPort`,
      url: WEB_ORIGIN,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { VITE_API_URL: API_URL },
    },
  ],
});
