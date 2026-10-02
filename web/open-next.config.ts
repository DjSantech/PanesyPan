import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import r2IncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache';
import memoryQueue from '@opennextjs/cloudflare/overrides/queue/memory-queue';

/**
 * Caché de las páginas en R2 y refresco en segundo plano: el menú del día (60 s) y el catálogo
 * (5 min) se actualizan solos sin volver a desplegar. Solo se usa revalidación por tiempo, así
 * que no hace falta tag cache.
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  queue: memoryQueue,
});
