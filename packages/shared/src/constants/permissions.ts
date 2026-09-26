import type { UserRole } from './roles';

/**
 * Permisos del sistema. El backend los valida SIEMPRE; el frontend solo los usa para
 * mostrar u ocultar opciones.
 */
export const PERMISSIONS = [
  'users:manage',
  'audit:read',
  'system:status',
  'pos:sell',
  'cash:operate',
  'catalog:read',
  'catalog:availability',
  'catalog:manage',
  'inventory:read',
  'inventory:record',
  'inventory:manage',
  'reports:read',
  'sales:void:approve',
  'settings:manage',
  'einvoice:manage',
  'web-orders:read',
  'web-orders:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  ADMIN: PERMISSIONS,
  // La cajera ve el catálogo y puede marcar productos como agotados, pero no cambia precios.
  // Anular ventas o dar descuentos por encima del tope exige el PIN de un administrador.
  // Del inventario ve el stock y registra producción y mermas; ajustar o fijar mínimos es del administrador.
  CASHIER: [
    'pos:sell',
    'cash:operate',
    'catalog:read',
    'catalog:availability',
    'inventory:read',
    'inventory:record',
    // Los pedidos de la web los atiende quien esté en caja.
    'web-orders:read',
    'web-orders:manage',
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: UserRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}
