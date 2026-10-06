import { createBrowserRouter } from 'react-router';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RequireAuth, RequirePermission } from '@/features/auth/RequireAuth';
import { SetPinPage } from '@/features/auth/SetPinPage';
import { NotFoundPage } from '@/features/errors/NotFoundPage';
import { HomePage } from '@/features/home/HomePage';
import { AppLayout } from '@/features/layout/AppLayout';

/**
 * Rutas en español (son visibles para el usuario). Las páginas de administración se cargan
 * bajo demanda para que la tablet del POS descargue lo mínimo.
 */
export const router = createBrowserRouter([
  { path: '/ingresar', element: <LoginPage />, errorElement: <RouteErrorBoundary /> },
  {
    path: '/',
    element: <RequireAuth />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: 'cambiar-clave', element: <ChangePasswordPage /> },
      { path: 'crear-pin', element: <SetPinPage /> },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          {
            path: 'usuarios',
            lazy: async () => {
              const { UsersPage } = await import('@/features/users/UsersPage');
              return {
                element: (
                  <RequirePermission permission="users:manage">
                    <UsersPage />
                  </RequirePermission>
                ),
              };
            },
          },
          {
            path: 'auditoria',
            lazy: async () => {
              const { AuditPage } = await import('@/features/audit/AuditPage');
              return {
                element: (
                  <RequirePermission permission="audit:read">
                    <AuditPage />
                  </RequirePermission>
                ),
              };
            },
          },
          {
            path: 'estado',
            lazy: async () => {
              const { SystemStatusPage } =
                await import('@/features/system-status/SystemStatusPage');
              return {
                element: (
                  <RequirePermission permission="system:status">
                    <SystemStatusPage />
                  </RequirePermission>
                ),
              };
            },
          },
          {
            path: 'catalogo',
            lazy: async () => {
              const { CatalogPage } = await import('@/features/catalog/CatalogPage');
              return {
                element: (
                  <RequirePermission permission="catalog:read">
                    <CatalogPage />
                  </RequirePermission>
                ),
              };
            },
          },
          {
            path: 'inventario',
            lazy: async () => {
              const { InventoryPage } = await import('@/features/inventory/InventoryPage');
              return {
                element: (
                  <RequirePermission permission="inventory:read">
                    <InventoryPage />
                  </RequirePermission>
                ),
              };
            },
          },
          {
            path: 'menu-del-dia',
            lazy: async () => {
              const { DailyMenuPage } = await import('@/features/catalog/DailyMenuPage');
              return {
                element: (
                  <RequirePermission permission="catalog:manage">
                    <DailyMenuPage />
                  </RequirePermission>
                ),
              };
            },
          },
          {
            path: 'vender',
            lazy: async () => {
              const { PosPage } = await import('@/features/pos/PosPage');
              return {
                element: (
                  <RequirePermission permission="pos:sell">
                    <PosPage />
                  </RequirePermission>
                ),
              };
            },
          },
          {
            path: 'ventas',
            lazy: async () => {
              const { SalesPage } = await import('@/features/sales/SalesPage');
              return {
                element: (
                  <RequirePermission permission="pos:sell">
                    <SalesPage />
                  </RequirePermission>
                ),
              };
            },
          },
          {
            path: 'pedidos-web',
            lazy: async () => {
              const { WebOrdersPage } = await import('@/features/web-orders/WebOrdersPage');
              return {
                element: (
                  <RequirePermission permission="web-orders:read">
                    <WebOrdersPage />
                  </RequirePermission>
                ),
              };
            },
          },
          {
            path: 'compras',
            lazy: async () => {
              const { PurchasesPage } = await import('@/features/purchases/PurchasesPage');
              return {
                element: (
                  <RequirePermission permission="purchases:record">
                    <PurchasesPage />
                  </RequirePermission>
                ),
              };
            },
          },
          {
            path: 'configuracion',
            lazy: async () => {
              const { SettingsPage } = await import('@/features/settings/SettingsPage');
              return {
                element: (
                  <RequirePermission permission="settings:manage">
                    <SettingsPage />
                  </RequirePermission>
                ),
              };
            },
          },
          {
            path: 'facturacion',
            lazy: async () => {
              const { EInvoicesPage } = await import('@/features/einvoice/EInvoicesPage');
              return {
                element: (
                  <RequirePermission permission="einvoice:manage">
                    <EInvoicesPage />
                  </RequirePermission>
                ),
              };
            },
          },
          {
            path: 'mi-cuenta',
            lazy: async () => {
              const { AccountPage } = await import('@/features/account/AccountPage');
              return { element: <AccountPage /> };
            },
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
