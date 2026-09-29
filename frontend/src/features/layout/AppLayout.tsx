import { BUSINESS_NAME, hasPermission, USER_ROLE_LABELS } from '@panesypan/shared';
import { CircleUser, Lock, LogOut, Monitor, Moon, Smartphone, Sun } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate } from 'react-router';
import { BrandLogo } from '@/components/BrandLogo';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { errorMessage } from '@/lib/api-errors';
import { applyTheme, useThemeMode, type ThemeMode } from '@/lib/theme';
import { cn, initials } from '@/lib/utils';
import { useSessionStore } from '@/stores/session.store';
import { toast } from 'sonner';
import { lockSession, logout, logoutEverywhere } from '../auth/auth.api';
import { useIdleLock } from '../auth/use-idle-lock';
import { useCurrentUser } from '../auth/use-session';
import { useWebOrderAlerts } from '../web-orders/use-web-order-alerts';
import { mobileNavItems, NAV_ITEMS } from './nav-items';

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Como el dispositivo', icon: Monitor },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Oscuro', icon: Moon },
];

/** Estructura de las páginas internas: encabezado, navegación (abajo en celular) y contenido. */
export function AppLayout() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const locked = useSessionStore((state) => state.locked);
  const themeMode = useThemeMode();
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);
  const [closingAll, setClosingAll] = useState(false);

  useIdleLock(!locked);
  const pendingWebOrders = useWebOrderAlerts();
  const badgeFor = (to: string): number => (to === '/pedidos-web' ? pendingWebOrders : 0);

  const items = NAV_ITEMS.filter(
    (item) => item.permission === undefined || hasPermission(user.role, item.permission),
  );
  const mobileItems = mobileNavItems(items);
  // El punto de venta usa todo el ancho de la tablet.
  const isPos = useMatch('/vender') !== null;

  const signOut = async () => {
    await logout();
    void navigate('/ingresar', { replace: true });
  };

  const signOutEverywhere = async () => {
    setClosingAll(true);
    try {
      await logoutEverywhere();
      void navigate('/ingresar', {
        replace: true,
        state: { notice: 'Cerraste la sesión en todos los dispositivos.' },
      });
    } catch (error) {
      toast.error(errorMessage(error));
      setClosingAll(false);
      setConfirmEverywhere(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <a
        href="#contenido"
        className="sr-only z-50 rounded-xl bg-primary px-4 py-2 font-bold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Saltar al contenido
      </a>

      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div
          className={cn(
            'mx-auto flex h-16 items-center gap-3 px-4',
            isPos ? 'max-w-screen-2xl' : 'max-w-6xl',
          )}
        >
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2.5 rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <BrandLogo size={40} />
            <span className="hidden truncate font-display text-xl font-bold sm:inline">
              {BUSINESS_NAME}
            </span>
          </Link>

          {items.length > 1 ? (
            <nav aria-label="Principal" className="ml-4 hidden items-center gap-1 md:flex">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold transition-colors',
                      isActive
                        ? 'bg-primary/12 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )
                  }
                >
                  <item.icon className="size-4.5" aria-hidden="true" />
                  <span className={items.length > 5 ? 'sr-only xl:not-sr-only' : undefined}>
                    {item.label}
                  </span>
                  {badgeFor(item.to) > 0 ? (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-xs font-extrabold text-white">
                      {badgeFor(item.to)}
                      <span className="sr-only"> pendientes</span>
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </nav>
          ) : null}

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              onClick={() => {
                void lockSession();
              }}
              aria-label="Bloquear pantalla"
              className="px-3"
            >
              <Lock aria-hidden="true" />
              <span className="hidden sm:inline">Bloquear</span>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-11 items-center gap-2 rounded-xl px-1.5 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                  aria-label={`Menú de ${user.name}`}
                >
                  <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground">
                    {initials(user.name)}
                  </span>
                  <span className="hidden text-left leading-tight lg:block">
                    <span className="block text-sm font-bold">{user.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {USER_ROLE_LABELS[user.role]}
                    </span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel className="text-sm text-foreground">
                  {user.name}
                  <span className="mt-0.5 block text-xs font-semibold text-muted-foreground">
                    @{user.username} · {USER_ROLE_LABELS[user.role]}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/mi-cuenta">
                    <CircleUser aria-hidden="true" /> Mi cuenta
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Apariencia</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={themeMode}
                  onValueChange={(value) => {
                    applyTheme(value as ThemeMode);
                  }}
                >
                  {THEME_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem key={option.value} value={option.value}>
                      <option.icon aria-hidden="true" /> {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    setConfirmEverywhere(true);
                  }}
                >
                  <Smartphone aria-hidden="true" /> Cerrar sesión en todos los dispositivos
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onSelect={() => {
                    void signOut();
                  }}
                >
                  <LogOut aria-hidden="true" /> Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main
        id="contenido"
        className={cn(
          'mx-auto px-4',
          isPos ? 'max-w-screen-2xl py-4' : 'max-w-6xl py-6',
          mobileItems.length > 1 && 'pb-28 md:pb-10',
          isPos && mobileItems.length > 1 && 'pb-44 md:pb-4',
        )}
      >
        <Outlet />
      </main>

      {mobileItems.length > 1 ? (
        <nav
          aria-label="Principal"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        >
          <ul
            className="mx-auto grid max-w-md"
            style={{
              gridTemplateColumns: `repeat(${String(mobileItems.length)}, minmax(0, 1fr))`,
            }}
          >
            {mobileItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'flex h-16 flex-col items-center justify-center gap-1 text-xs font-bold',
                      isActive ? 'text-primary' : 'text-muted-foreground',
                    )
                  }
                >
                  <span className="relative">
                    <item.icon className="size-6" aria-hidden="true" />
                    {badgeFor(item.to) > 0 ? (
                      <span className="absolute -top-1.5 -right-2.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-danger px-1 text-[0.65rem] font-extrabold text-white">
                        {badgeFor(item.to)}
                        <span className="sr-only"> pendientes</span>
                      </span>
                    ) : null}
                  </span>
                  {item.mobileLabel ?? item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <ConfirmDialog
        open={confirmEverywhere}
        onOpenChange={setConfirmEverywhere}
        title="¿Cerrar sesión en todos los dispositivos?"
        description="Se cerrarán todas tus sesiones abiertas, incluida esta. Tendrás que volver a ingresar con tu contraseña."
        confirmLabel="Cerrar todas"
        destructive
        pending={closingAll}
        onConfirm={() => {
          void signOutEverywhere();
        }}
      />
    </div>
  );
}
