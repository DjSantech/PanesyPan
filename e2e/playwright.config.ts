import { defineConfig, devices } from '@playwright/test';
import { API_URL, WEB_ORIGIN, WEB_PORT } from './fixtures/env';

const isCI = process.env.CI !== undefined;

/**
 * Pruebas de punta a punta: un navegador real contra la API y el POS de verdad, con una base de
 * datos en memoria. Uso: `pnpm test:e2e` desde la raíz (la primera vez: ver README).
 */
export default defineConfig({
  testDir: './tests',
  // Los flujos comparten la misma base de datos y van en orden (primero el administrador).
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_ORIGIN,
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    // Sin animaciones (la app respeta esta preferencia): pantallas estables para revisar.
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'tablet',
      // El POS se usa en una tablet horizontal.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: 'node --import tsx stack.ts',
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
