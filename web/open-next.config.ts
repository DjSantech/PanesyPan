import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import kvIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/kv-incremental-cache';
import memoryQueue from '@opennextjs/cloudflare/overrides/queue/memory-queue';

/**
 * Caché de las páginas en Workers KV y refresco en segundo plano: el menú del día (5 min) y el
 * catálogo (15 min) se actualizan solos sin volver a desplegar. Los tiempos están pensados para
 * no pasar de las 1.000 escrituras diarias del plan gratis de KV. Solo se usa revalidación por
 * tiempo, así que no hace falta tag cache.
 */
export default defineCloudflareConfig({
  incrementalCache: kvIncrementalCache,
  queue: memoryQueue,
});
