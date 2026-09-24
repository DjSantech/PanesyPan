import type { EInvoiceEnvironment, EInvoiceProvider } from '@panesypan/shared';
import type { Env } from '../../config/env';
import { createFactusProvider, type FactusCredentials } from './providers/factus';
import type { EInvoiceProviderClient } from './providers/provider';
import { createSimulatedProvider } from './providers/simulated';

/**
 * Proveedores de facturación disponibles en este servidor. Las credenciales salen del entorno
 * (nunca de la base de datos ni de la pantalla); `createApp` lo configura al arrancar.
 */
interface Registry {
  factus: FactusCredentials | null;
  clients: Map<EInvoiceProvider, EInvoiceProviderClient>;
}

let registry: Registry = { factus: null, clients: new Map() };

export function configureEInvoicing(env: Env): void {
  const { FACTUS_CLIENT_ID, FACTUS_CLIENT_SECRET, FACTUS_USERNAME, FACTUS_PASSWORD } = env;
  const factus =
    FACTUS_CLIENT_ID !== undefined &&
    FACTUS_CLIENT_SECRET !== undefined &&
    FACTUS_USERNAME !== undefined &&
    FACTUS_PASSWORD !== undefined
      ? {
          environment: env.FACTUS_ENV,
          clientId: FACTUS_CLIENT_ID,
          clientSecret: FACTUS_CLIENT_SECRET,
          username: FACTUS_USERNAME,
          password: FACTUS_PASSWORD,
        }
      : null;
  registry = { factus, clients: new Map() };
}

export function availableProviders(): EInvoiceProvider[] {
  return registry.factus === null ? ['SIMULATED'] : ['SIMULATED', 'FACTUS'];
}

export function isProviderAvailable(provider: EInvoiceProvider): boolean {
  return availableProviders().includes(provider);
}

export function providerEnvironment(provider: EInvoiceProvider): EInvoiceEnvironment {
  if (provider === 'SIMULATED') return 'SIMULATED';
  return registry.factus?.environment === 'production' ? 'PRODUCTION' : 'SANDBOX';
}

/** Cliente del proveedor (se crea una vez y conserva su token), o null si no está configurado. */
export function getProviderClient(provider: EInvoiceProvider): EInvoiceProviderClient | null {
  const cached = registry.clients.get(provider);
  if (cached !== undefined) return cached;
  let client: EInvoiceProviderClient | null = null;
  if (provider === 'SIMULATED') client = createSimulatedProvider();
  else if (registry.factus !== null) client = createFactusProvider(registry.factus);
  if (client !== null) registry.clients.set(provider, client);
  return client;
}

/** Solo para pruebas: reemplaza el cliente de un proveedor (p. ej. uno que falla a propósito). */
export function setProviderClientForTests(
  provider: EInvoiceProvider,
  client: EInvoiceProviderClient | null,
): void {
  if (client === null) registry.clients.delete(provider);
  else registry.clients.set(provider, client);
}
