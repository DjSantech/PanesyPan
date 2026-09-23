import { formatLongDateCO, hasPermission } from '@panesypan/shared';
import { Activity, ChevronRight, ScrollText, Store, Users, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, Card, CardContent } from '@/components/ui/surface';
import { firstName } from '@/lib/utils';
import { useCurrentUser } from '../auth/use-session';

interface Shortcut {
  to: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

const ADMIN_SHORTCUTS: readonly Shortcut[] = [
  {
    to: '/usuarios',
    title: 'Usuarios',
    description: 'Crea cajeras, restablece contraseñas y PIN.',
    icon: Users,
  },
  {
    to: '/auditoria',
    title: 'Auditoría',
    description: 'Quién hizo qué y cuándo: ingresos, cambios y alertas.',
    icon: ScrollText,
  },
  {
    to: '/estado',
    title: 'Estado del sistema',
    description: 'Revisa que la API y la base de datos estén en línea.',
    icon: Activity,
  },
];

const UPCOMING = [
  'Catálogo y menú del día',
  'Punto de venta y mesas',
  'Caja y arqueo',
  'Inventario',
  'Estadísticas en tiempo real',
];

export function HomePage() {
  const user = useCurrentUser();
  const isAdmin = hasPermission(user.role, 'users:manage');
  const today = formatLongDateCO(new Date());

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="text-sm font-bold text-muted-foreground">{today}</p>
        <h1 className="font-display text-3xl font-bold">Hola, {firstName(user.name)}</h1>
      </div>

      {isAdmin ? (
        <section aria-labelledby="atajos" className="grid gap-3">
          <h2 id="atajos" className="sr-only">
            Accesos rápidos
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ADMIN_SHORTCUTS.map((shortcut) => (
              <Link
                key={shortcut.to}
                to={shortcut.to}
                className="group rounded-2xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Card className="h-full transition-colors group-hover:border-primary/50">
                  <CardContent className="flex items-start gap-4">
                    <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
                      <shortcut.icon className="size-6" aria-hidden="true" />
                    </span>
                    <span className="grid flex-1 gap-1">
                      <span className="flex items-center justify-between font-extrabold">
                        {shortcut.title}
                        <ChevronRight
                          className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </span>
                      <span className="text-sm text-muted-foreground">{shortcut.description}</span>
                    </span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent-soft-foreground">
            <Store className="size-7" aria-hidden="true" />
          </span>
          <div className="grid flex-1 gap-2">
            <p className="font-extrabold">Muy pronto aquí estará el punto de venta</p>
            <p className="text-sm text-muted-foreground">
              Estamos construyendo el sistema por etapas. Lo que viene:
            </p>
            <ul className="flex flex-wrap gap-2">
              {UPCOMING.map((item) => (
                <li key={item}>
                  <Badge tone="accent">{item}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
