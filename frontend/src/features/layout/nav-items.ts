import type { Permission } from '@panesypan/shared';
import {
  BarChart3,
  Boxes,
  Croissant,
  FileText,
  House,
  ReceiptText,
  ScrollText,
  Settings,
  ShoppingBag,
  ShoppingBasket,
  Soup,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  /** Texto corto para la barra del celular (por defecto, `label`). */
  mobileLabel?: string;
  icon: LucideIcon;
  /** Sin permiso: visible para cualquier usuario con sesión. */
  permission?: Permission;
  /**
   * Barra inferior del celular: true (por defecto) siempre va; 'if-room' solo si queda espacio;
   * false nunca (se abre desde el inicio).
   */
  mobile?: boolean | 'if-room';
}

/** Máximo de elementos en la barra inferior del celular. */
export const MOBILE_NAV_MAX = 5;

/** Elementos de la barra del celular: los fijos y, si caben, los opcionales (en orden). */
export function mobileNavItems<T extends Pick<NavItem, 'mobile'>>(items: readonly T[]): T[] {
  const fixed = items.filter((item) => item.mobile === undefined || item.mobile === true).length;
  let room = MOBILE_NAV_MAX - fixed;
  return items.filter((item) => {
    if (item.mobile === false) return false;
    if (item.mobile !== 'if-room') return true;
    if (room <= 0) return false;
    room -= 1;
    return true;
  });
}

/**
 * En el celular caben máximo 5 elementos en la barra inferior. La cajera ve Vender, Ventas,
 * Catálogo, Pedidos web e Inventario; el administrador ve el inicio en lugar de Inventario (lo
 * abre desde los accesos del inicio).
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Inicio', icon: House, permission: 'reports:read' },
  { to: '/vender', label: 'Vender', icon: ShoppingBasket, permission: 'pos:sell' },
  { to: '/ventas', label: 'Ventas', icon: ReceiptText, permission: 'pos:sell' },
  { to: '/catalogo', label: 'Catálogo', icon: Croissant, permission: 'catalog:read' },
  {
    to: '/pedidos-web',
    label: 'Pedidos web',
    mobileLabel: 'Pedidos',
    icon: ShoppingBag,
    permission: 'web-orders:read',
  },
  {
    to: '/inventario',
    label: 'Inventario',
    icon: Boxes,
    permission: 'inventory:read',
    mobile: 'if-room',
  },
  {
    to: '/reportes',
    label: 'Reportes',
    icon: BarChart3,
    permission: 'reports:read',
    mobile: false,
  },
  {
    to: '/cajas',
    label: 'Cajas',
    icon: Wallet,
    permission: 'cash:review',
    mobile: false,
  },
  {
    to: '/compras',
    label: 'Compras',
    icon: Truck,
    permission: 'purchases:record',
    mobile: false,
  },
  {
    to: '/menu-del-dia',
    label: 'Menú',
    icon: Soup,
    permission: 'catalog:manage',
    mobile: false,
  },
  { to: '/usuarios', label: 'Usuarios', icon: Users, permission: 'users:manage', mobile: false },
  {
    to: '/auditoria',
    label: 'Auditoría',
    icon: ScrollText,
    permission: 'audit:read',
    mobile: false,
  },
  {
    to: '/facturacion',
    label: 'Facturación',
    icon: FileText,
    permission: 'einvoice:manage',
    mobile: false,
  },
  {
    to: '/configuracion',
    label: 'Ajustes',
    icon: Settings,
    permission: 'settings:manage',
    mobile: false,
  },
];
