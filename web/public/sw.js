/* global self, caches */
// Desinstalador del service worker del sistema POS.
// Antes, panesypan.com mostraba el sistema (una PWA con service worker en /sw.js). Los navegadores
// que lo visitaron lo siguen teniendo y podrían mostrar el sistema guardado en vez de esta web.
// Cuando el navegador busca una actualización de /sw.js recibe este archivo, que borra la caché,
// se desinstala y recarga la página. La web pública no registra ningún service worker.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const client of windows) client.navigate(client.url);
    })(),
  );
});
