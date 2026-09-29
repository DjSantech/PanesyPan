import { hasPermission, type UserRole } from '@panesypan/shared';
import { describe, expect, it } from 'vitest';
import { MOBILE_NAV_MAX, mobileNavItems, NAV_ITEMS } from './nav-items';

const barFor = (role: UserRole) =>
  mobileNavItems(
    NAV_ITEMS.filter(
      (item) => item.permission === undefined || hasPermission(role, item.permission),
    ),
  ).map((item) => item.to);

describe('barra inferior del celular', () => {
  it('la cajera ve Pedidos web e Inventario', () => {
    expect(barFor('CASHIER')).toEqual([
      '/vender',
      '/ventas',
      '/catalogo',
      '/pedidos-web',
      '/inventario',
    ]);
  });

  it('el administrador ve el inicio y Pedidos web; Inventario queda en el inicio', () => {
    const bar = barFor('ADMIN');
    expect(bar).toEqual(['/', '/vender', '/ventas', '/catalogo', '/pedidos-web']);
    expect(bar.length).toBeLessThanOrEqual(MOBILE_NAV_MAX);
  });
});
