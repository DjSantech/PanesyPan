import type { Permission } from '@panesypan/shared';
import {
  Boxes,
  Croissant,
  FileText,
  House,
  ReceiptText,
  ScrollText,
  Settings,
  ShoppingBasket,
  Soup,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Sin permiso: visible para cualquier usuario con sesión. */
  permission?: Permission;
  /** false = no va en la barra inferior del celular (se abre desde el inicio). */
  mobile?: boolean;
}

/**
 * En el celular caben máximo 5 elementos en la barra inferior. La cajera ve Vender, Ventas y
 * Catálogo e Inventario; el administrador además el inicio, y el resto desde los accesos del inicio.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Inicio', icon: House, permission: 'reports:read' },
  { to: '/vender', label: 'Vender', icon: ShoppingBasket, permission: 'pos:sell' },
  { to: '/ventas', label: 'Ventas', icon: ReceiptText, permission: 'pos:sell' },
  { to: '/catalogo', label: 'Catálogo', icon: Croissant, permission: 'catalog:read' },
  { to: '/inventario', label: 'Inventario', icon: Boxes, permission: 'inventory:read' },
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
