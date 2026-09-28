/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // La actualización la confirma la persona (un aviso en pantalla): recargar sola en medio de
      // una venta haría perder tiempo en el mostrador.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon-32.png', 'apple-touch-icon.png', 'logo-panesypan-320.webp'],
      manifest: {
        name: 'Panes & Pan · Sistema',
        short_name: 'Panes & Pan',
        description: 'Punto de venta y panel administrativo de Panes & Pan.',
        lang: 'es-CO',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7ecdf',
        theme_color: '#a1452e',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Solo se guarda el "cascarón" de la app (HTML, JS, CSS, fuentes e íconos). La API está
        // en otro dominio y no se guarda nada de ella: ventas, cajas y sesiones siempre en vivo.
        globPatterns: ['**/*.{js,css,html,woff2,png,webp,svg}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { sourcemap: false },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
