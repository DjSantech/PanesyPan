import type { Permission } from '@panesypan/shared';
import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { EmptyState, ErrorState, FullScreenLoader } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api-errors';
import { useSessionStore } from '@/stores/session.store';
import { LockScreen } from './LockScreen';
import { useCan, useSessionQuery } from './use-session';

const CHANGE_PASSWORD_PATH = '/cambiar-clave';
const SET_PIN_PATH = '/crear-pin';

/**
 * Protege las rutas internas:
 *  1. Sin sesión → login.
 *  2. Contraseña temporal → obliga a cambiarla.
 *  3. Sin PIN → obliga a crearlo (lo necesita la pantalla de bloqueo).
 *  4. Sesión bloqueada → pantalla de PIN encima de todo.
 */
export function RequireAuth() {
  const session = useSessionQuery();
  const locked = useSessionStore((state) => state.locked);
  const location = useLocation();

  if (session.isPending) return <FullScreenLoader label="Verificando la sesión…" />;

  if (session.isError) {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <ErrorState
          title="No se pudo conectar con el servidor"
          description={errorMessage(session.error)}
          onRetry={() => {
            void session.refetch();
          }}
        />
      </main>
    );
  }

  if (session.data === null) {
    return <Navigate to="/ingresar" replace state={{ from: location.pathname }} />;
  }

  const { user } = session.data;
  if (user.mustChangePassword && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }
  if (!user.mustChangePassword && !user.hasPin && location.pathname !== SET_PIN_PATH) {
    return <Navigate to={SET_PIN_PATH} replace />;
  }

  return (
    <>
      <Outlet />
      {locked ? <LockScreen /> : null}
    </>
  );
}

/** Oculta una página si el rol no tiene el permiso (el backend igual lo valida). */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const allowed = useCan(permission);
  if (allowed) return children;
  return (
    <EmptyState
      icon={ShieldAlert}
      title="No tienes acceso a esta sección"
      description="Si crees que es un error, habla con el administrador."
      action={
        <Button asChild variant="outline" className="mt-2">
          <Link to="/">Volver al inicio</Link>
        </Button>
      }
    />
  );
}
