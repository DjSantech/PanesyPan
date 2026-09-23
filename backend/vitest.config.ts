import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // La primera ejecución descarga el binario de MongoDB para las pruebas.
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
