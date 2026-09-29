import { House, RefreshCw, TriangleAlert } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';

/** Página completa: la barra lateral y el resto del sistema también fallaron. */
function CrashScreen({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <TriangleAlert className="size-10 text-danger" aria-hidden="true" />
        <p className="text-lg font-extrabold">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {onRetry === undefined ? null : (
            <Button
              onClick={onRetry}
              variant="outline"
              // El botón sigue en el DOM que falló: recarga la página entera, más confiable.
              type="button"
            >
              <RefreshCw aria-hidden="true" /> Reintentar
            </Button>
          )}
          <Button asChild>
            <Link to="/">
              <House aria-hidden="true" /> Ir al inicio
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Errores de las rutas creadas con `createBrowserRouter` (404 propio de React Router, y los
 * que el `loader`/`lazy` de una ruta lance). Los errores del render de una página los atrapa
 * `RootErrorBoundary`, más abajo.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    // Coincide con el catch-all "*" del router; aquí solo si React Router aborta antes.
    return (
      <CrashScreen
        title="Esta página no existe"
        description="Revisa la dirección o vuelve al inicio."
      />
    );
  }
  if (import.meta.env.DEV) console.error('Error de ruta:', error);
  return (
    <CrashScreen
      title="Algo salió mal"
      description="Hubo un problema inesperado. Recarga la página; si sigue, avisa al administrador."
      onRetry={() => {
        window.location.reload();
      }}
    />
  );
}

interface State {
  error: unknown;
}

/**
 * Último respaldo: si un componente lanza durante el render y no lo atrapó nada más (por
 * ejemplo, dentro del layout ya montado), esto evita la pantalla en blanco.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Error sin capturar en la interfaz:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <CrashScreen
          title="Algo salió mal"
          description="Hubo un problema inesperado. Recarga la página; si sigue, avisa al administrador."
          onRetry={() => {
            window.location.reload();
          }}
        />
      );
    }
    return this.props.children;
  }
}
