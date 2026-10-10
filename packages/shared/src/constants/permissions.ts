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
  'suppliers:manage',
  'einvoice:manage',
  'web-orders:read',
  'web-orders:manage',
  'purchases:record',
  'cash:review',
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
    // Recibe los pedidos de los proveedores y los paga con la caja.
    'purchases:record',
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: UserRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** Nivel de acceso de un perfil a un módulo (cómo se muestra en la matriz de perfiles). */
export const ACCESS_LEVELS = ['NONE', 'READ', 'FULL'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const ACCESS_LEVEL_LABELS: Readonly<Record<AccessLevel, string>> = {
  NONE: 'Ninguno',
  READ: 'Lectura',
  FULL: 'Total',
};

export interface PermissionModule {
  key: string;
  label: string;
  /** Qué permite cada nivel, en palabras de la panadería. */
  hint: string;
  /** Permisos del nivel "Lectura" (null si el módulo no tiene ese nivel). */
  read: readonly Permission[] | null;
  /** Permisos del nivel "Total" (incluye los de lectura). */
  full: readonly Permission[];
}

/**
 * Módulos de la matriz de perfiles. Cada permiso del sistema está en exactamente un módulo, y
 * el perfil "Cajera" de siempre se puede expresar con estos niveles.
 */
export const PERMISSION_MODULES: readonly PermissionModule[] = [
  {
    key: 'sales',
    label: 'Ventas',
    hint: 'Lectura: vender y atender pedidos web · Total: además autoriza anulaciones y descuentos',
    read: ['pos:sell', 'web-orders:read', 'web-orders:manage'],
    full: ['pos:sell', 'web-orders:read', 'web-orders:manage', 'sales:void:approve'],
  },
  {
    key: 'cash',
    label: 'Caja',
    hint: 'Lectura: abrir, mover y cerrar su caja · Total: además revisa y confirma cierres',
    read: ['cash:operate'],
    full: ['cash:operate', 'cash:review'],
  },
  {
    key: 'catalog',
    label: 'Catálogo',
    hint: 'Lectura: ver productos y marcarlos agotados · Total: crear, editar y cambiar precios',
    read: ['catalog:read', 'catalog:availability'],
    full: ['catalog:read', 'catalog:availability', 'catalog:manage'],
  },
  {
    key: 'inventory',
    label: 'Inventario',
    hint: 'Lectura: ver stock y registrar producción y mermas · Total: ajustes y mínimos',
    read: ['inventory:read', 'inventory:record'],
    full: ['inventory:read', 'inventory:record', 'inventory:manage'],
  },
  {
    key: 'purchases',
    label: 'Compras',
    hint: 'Total: recibir y pagar pedidos de proveedores',
    read: null,
    full: ['purchases:record'],
  },
  {
    key: 'suppliers',
    label: 'Proveedores',
    hint: 'Total: crear y editar proveedores',
    read: null,
    full: ['suppliers:manage'],
  },
  {
    key: 'reports',
    label: 'Reportes',
    hint: 'Lectura: ver el tablero y los reportes',
    read: ['reports:read'],
    full: ['reports:read'],
  },
  {
    key: 'audit',
    label: 'Auditoría',
    hint: 'Lectura: ver el registro de auditoría',
    read: ['audit:read'],
    full: ['audit:read'],
  },
  {
    key: 'einvoice',
    label: 'Facturación',
    hint: 'Total: gestionar la facturación electrónica',
    read: null,
    full: ['einvoice:manage'],
  },
  {
    key: 'settings',
    label: 'Ajustes',
    hint: 'Lectura: ver el estado del sistema · Total: cambiar la configuración',
    read: ['system:status'],
    full: ['system:status', 'settings:manage'],
  },
  {
    key: 'users',
    label: 'Usuarios',
    hint: 'Total: gestionar usuarios y perfiles',
    read: null,
    full: ['users:manage'],
  },
];

/** Nivel de un módulo según una lista de permisos. */
export function moduleLevel(
  module: PermissionModule,
  permissions: readonly Permission[],
): AccessLevel {
  const hasAll = (list: readonly Permission[]) => list.every((p) => permissions.includes(p));
  if (hasAll(module.full)) return 'FULL';
  if (module.read !== null && hasAll(module.read)) return 'READ';
  return 'NONE';
}

/** Permisos que resultan de elegir un nivel por módulo. */
export function permissionsFromLevels(
  levels: Readonly<Partial<Record<string, AccessLevel>>>,
): Permission[] {
  const result = new Set<Permission>();
  for (const module of PERMISSION_MODULES) {
    const level = levels[module.key] ?? 'NONE';
    const list = level === 'FULL' ? module.full : level === 'READ' ? (module.read ?? []) : [];
    for (const permission of list) result.add(permission);
  }
  return PERMISSIONS.filter((p) => result.has(p));
}
