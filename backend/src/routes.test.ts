import {
  apiErrorResponseSchema,
  hasPermission,
  USER_ROLES,
  type Permission,
  type UserRole,
} from '@panesypan/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDatabase } from '../test/database';
import {
  createTestUser,
  DEFAULT_PASSWORD,
  initModels,
  login,
  resetDatabase,
  type LoggedIn,
} from '../test/factories';
import { createTestEnv, silentLogger } from '../test/helpers';
import { createApp } from './app';

/**
 * Matriz de acceso de TODA la API de negocio. Si alguien agrega una ruta y no la declara aquí,
 * esta prueba falla: así ninguna ruta nueva queda sin sesión o con el permiso equivocado.
 *   public → no exige sesión · session → cualquier usuario con sesión · Permission → ese permiso
 */
type Access = 'public' | 'session' | Permission;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

const ROUTES: readonly (readonly [Method, string, Access])[] = [
  ['post', '/auth/login', 'public'],
  ['post', '/auth/refresh', 'public'],
  ['post', '/auth/logout', 'public'],
  ['get', '/auth/me', 'session'],
  ['post', '/auth/lock', 'session'],
  ['post', '/auth/unlock', 'session'],
  ['post', '/auth/logout-all', 'session'],
  ['post', '/auth/change-password', 'session'],
  ['put', '/auth/pin', 'session'],

  ['get', '/users', 'users:manage'],
  ['post', '/users', 'users:manage'],
  ['get', '/users/:id', 'users:manage'],
  ['patch', '/users/:id', 'users:manage'],
  ['patch', '/users/:id/status', 'users:manage'],
  ['post', '/users/:id/reset-password', 'users:manage'],
  ['post', '/users/:id/reset-pin', 'users:manage'],
  ['post', '/users/:id/unlock', 'users:manage'],

  ['get', '/audit-logs', 'audit:read'],

  ['get', '/categories', 'catalog:read'],
  ['post', '/categories', 'catalog:manage'],
  ['put', '/categories/order', 'catalog:manage'],
  ['patch', '/categories/:id', 'catalog:manage'],
  ['get', '/products', 'catalog:read'],
  ['get', '/products/:id', 'catalog:read'],
  ['post', '/products', 'catalog:manage'],
  ['patch', '/products/:id', 'catalog:manage'],
  ['patch', '/products/:id/availability', 'catalog:availability'],
  ['post', '/products/:id/image', 'catalog:manage'],
  ['delete', '/products/:id/image', 'catalog:manage'],
  ['get', '/products/export', 'catalog:manage'],
  ['post', '/products/import', 'catalog:manage'],
  ['post', '/products/bulk-price', 'catalog:manage'],
  ['post', '/products/bulk-category', 'catalog:manage'],
  ['get', '/public/images/:file', 'public'],
  ['get', '/public/catalogo', 'public'],
  ['get', '/public/menu-del-dia', 'public'],
  ['get', '/public/negocio', 'public'],
  ['post', '/public/pedidos', 'public'],
  ['get', '/web-orders', 'web-orders:read'],
  ['patch', '/web-orders/:id/status', 'web-orders:manage'],
  ['post', '/web-orders/:id/checkout', 'web-orders:manage'],
  ['post', '/web-orders/:id/cancel', 'web-orders:manage'],
  ['get', '/daily-menus/:date', 'catalog:read'],
  ['put', '/daily-menus/:date', 'catalog:manage'],

  ['get', '/settings', 'session'],
  ['patch', '/settings', 'settings:manage'],

  ['get', '/suppliers', 'cash:operate'],
  ['post', '/suppliers', 'suppliers:manage'],
  ['patch', '/suppliers/:id', 'suppliers:manage'],
  ['get', '/purchases', 'purchases:record'],
  ['post', '/purchases', 'purchases:record'],
  ['get', '/purchases/order-suggestions', 'suppliers:manage'],

  ['get', '/cash-concepts', 'cash:operate'],
  ['post', '/cash-concepts', 'settings:manage'],
  ['patch', '/cash-concepts/:id', 'settings:manage'],
  ['get', '/staff', 'cash:operate'],
  ['post', '/staff', 'settings:manage'],
  ['patch', '/staff/:id', 'settings:manage'],

  ['get', '/cash-shifts/current', 'cash:operate'],
  ['post', '/cash-shifts', 'cash:operate'],
  ['get', '/cash-shifts/current/movements', 'cash:operate'],
  ['post', '/cash-shifts/current/movements', 'cash:operate'],
  ['post', '/cash-shifts/current/close', 'cash:operate'],
  ['get', '/cash-shifts', 'cash:review'],
  ['get', '/cash-shifts/:id', 'cash:review'],
  ['post', '/cash-shifts/:id/confirm', 'cash:review'],

  ['get', '/inventory', 'inventory:read'],
  ['get', '/inventory/movements', 'inventory:read'],
  ['post', '/inventory/production', 'inventory:record'],
  ['post', '/inventory/waste', 'inventory:record'],
  ['post', '/inventory/self-consumption', 'inventory:record'],
  ['post', '/inventory/adjustments', 'inventory:manage'],
  ['patch', '/inventory/:productId/min-stock', 'inventory:manage'],

  ['get', '/einvoices', 'einvoice:manage'],
  ['get', '/einvoices/status', 'einvoice:manage'],
  ['post', '/einvoices/:id/retry', 'einvoice:manage'],

  ['get', '/reports/dashboard', 'reports:read'],
  ['get', '/reports/export/:kind', 'reports:read'],
  ['get', '/reports/business', 'reports:read'],

  ['post', '/sales/checkout', 'pos:sell'],
  ['get', '/sales', 'pos:sell'],
  ['get', '/sales/:id', 'pos:sell'],
  ['post', '/sales/:id/void', 'pos:sell'],
  ['post', '/sales/:id/returns', 'pos:sell'],
  ['get', '/tabs', 'pos:sell'],
  ['post', '/tabs', 'pos:sell'],
  ['patch', '/tabs/:id', 'pos:sell'],
  ['post', '/tabs/:id/lines', 'pos:sell'],
  ['patch', '/tabs/:id/lines/:lineId', 'pos:sell'],
  ['delete', '/tabs/:id/lines/:lineId', 'pos:sell'],
  ['post', '/tabs/:id/checkout', 'pos:sell'],
  ['post', '/tabs/:id/cancel', 'pos:sell'],
];

const SAMPLE_PARAMS: Record<string, string> = {
  id: '64b000000000000000000001',
  lineId: '64b000000000000000000002',
  productId: '64b000000000000000000003',
  date: '2026-01-15',
  kind: 'sales',
  file: '64b000000000000000000004.webp',
};

const concretePath = (pattern: string): string =>
  `/api/v1${pattern.replace(/:(\w+)/g, (_match, name: string) => SAMPLE_PARAMS[name] ?? name)}`;

// ── Lectura de las rutas registradas en Express ──────────────────────

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: RouteLayer[] };
  slash?: boolean;
  matchers?: ((path: string) => { path: string } | false)[];
}

/** Todas las rutas (con su router) que cuelgan de /api/v1. */
function apiRouteLayers(app: unknown): RouteLayer[] {
  const root = (app as { router: { stack: RouteLayer[] } }).router.stack;
  const api = root.find(
    (layer) => layer.handle?.stack !== undefined && Boolean(layer.matchers?.[0]?.('/api/v1/auth')),
  );
  if (api?.handle?.stack === undefined) throw new Error('No se encontró el router /api/v1');
  return api.handle.stack;
}

/** Busca la ruta que atendería `method pattern` y la devuelve (o null). */
function resolveRoute(stack: RouteLayer[], pattern: string, method: Method): RouteLayer | null {
  for (const layer of stack) {
    if (layer.route !== undefined) {
      if (layer.route.path === pattern && layer.route.methods[method] === true) return layer;
      continue;
    }
    const children = layer.handle?.stack;
    if (children === undefined) continue;
    // Un router montado sin ruta (`slash`) atiende todo sin consumir nada del patrón.
    const matched = layer.slash === true ? { path: '' } : layer.matchers?.[0]?.(pattern);
    if (matched === undefined || matched === false) continue;
    const found = resolveRoute(children, pattern.slice(matched.path.length) || '/', method);
    if (found !== null) return found;
  }
  return null;
}

function allRoutes(stack: RouteLayer[]): RouteLayer[] {
  return stack.flatMap((layer) =>
    layer.route !== undefined ? [layer] : allRoutes(layer.handle?.stack ?? []),
  );
}

// ── Pruebas ──────────────────────────────────────────────────────────

const app = createApp(createTestEnv({ AUTH_RATE_LIMIT_MAX: '1000' }), silentLogger);
const errorOf = (body: unknown) => apiErrorResponseSchema.parse(body).error;

let stopDatabase: (() => Promise<void>) | undefined;
const sessions = new Map<UserRole, LoggedIn>();

beforeAll(async () => {
  stopDatabase = await startTestDatabase();
  await initModels();
});

afterAll(async () => {
  await stopDatabase?.();
});

beforeEach(async () => {
  await resetDatabase();
  for (const role of USER_ROLES) {
    const username = `rol${role.toLowerCase()}`;
    await createTestUser({ username, role });
    sessions.set(role, await login(app, username, DEFAULT_PASSWORD));
  }
});

function call(method: Method, pattern: string, who?: LoggedIn) {
  const path = concretePath(pattern);
  const agent = who?.agent ?? request(app);
  const req = agent[method](path);
  if (who !== undefined && method !== 'get') req.set('X-CSRF-Token', who.csrfToken);
  return method === 'get' ? req : req.send({});
}

describe('matriz de acceso de la API', () => {
  it('cada ruta registrada está declarada en la matriz (y viceversa)', () => {
    const stack = apiRouteLayers(app);
    const declared = new Set<RouteLayer>();
    const missing: string[] = [];
    for (const [method, pattern] of ROUTES) {
      const layer = resolveRoute(stack, pattern, method);
      if (layer === null) missing.push(`${method.toUpperCase()} ${pattern}`);
      else declared.add(layer);
    }
    expect(missing, 'Rutas de la matriz que ya no existen').toEqual([]);

    const undeclared = allRoutes(stack)
      .filter((layer) => !declared.has(layer))
      .map(
        (layer) =>
          `${Object.keys(layer.route?.methods ?? {}).join(',')} ${layer.route?.path ?? ''}`,
      );
    expect(undeclared, 'Rutas nuevas sin declarar en la matriz de acceso').toEqual([]);
  });

  it.each(ROUTES.filter(([, , access]) => access !== 'public'))(
    '%s %s exige sesión',
    async (method, pattern) => {
      const response = await call(method, pattern);
      expect(response.status).toBe(401);
      expect(errorOf(response.body).code).toBe('UNAUTHORIZED');
    },
  );

  const permissionRoutes = ROUTES.filter(
    (entry): entry is readonly [Method, string, Permission] =>
      entry[2] !== 'public' && entry[2] !== 'session',
  );

  it.each(permissionRoutes)('%s %s respeta el permiso %s', async (method, pattern, permission) => {
    for (const role of USER_ROLES) {
      const who = sessions.get(role);
      if (who === undefined) throw new Error(`Sin sesión para ${role}`);
      const response = await call(method, pattern, who);
      if (hasPermission(role, permission)) {
        // Con permiso puede fallar por datos (400/404/409), pero nunca por acceso.
        expect([401, 403], `${role} debería poder usar ${method} ${pattern}`).not.toContain(
          response.status,
        );
      } else {
        expect(response.status, `${role} no debería poder usar ${method} ${pattern}`).toBe(403);
        expect(errorOf(response.body).code).toBe('FORBIDDEN');
      }
    }
  });
});
