import type { CapacitorConfig } from '@capacitor/cli';

// La app carga el sistema remoto (no el build local) para que las cookies de sesión
// sigan siendo del mismo origen; el modo sin conexión lo cubre el service worker.
const config: CapacitorConfig = {
  appId: 'com.panesypan.pos',
  appName: 'Panes & Pan POS',
  webDir: 'dist',
  server: {
    url: 'https://sistema.panesypan.com',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
