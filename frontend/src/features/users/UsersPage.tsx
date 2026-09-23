import {
  formatDateTimeCO,
  USER_ROLE_LABELS,
  type CreateUserRequest,
  type ListUsersQuery,
  type UpdateUserRequest,
  type User,
} from '@panesypan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EllipsisVertical,
  KeyRound,
  LockOpen,
  Pencil,
  RotateCcw,
  Search,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, ErrorState, PageHeader } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/form';
import { Badge, Card, Skeleton } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn, initials } from '@/lib/utils';
import { useCurrentUser } from '../auth/use-session';
import { TemporaryPasswordDialog } from './TemporaryPasswordDialog';
import { UserFormDialog } from './UserFormDialog';
import {
  createUser,
  listUsers,
  resetUserPassword,
  resetUserPin,
  setUserStatus,
  unlockUser,
  updateUser,
  usersKeys,
} from './users.api';

type StatusFilter = ListUsersQuery['status'];
type ConfirmAction = 'deactivate' | 'activate' | 'reset-password' | 'reset-pin' | 'unlock';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
  { value: 'all', label: 'Todos' },
];

const CONFIRM_TEXT: Record<
  ConfirmAction,
  { title: string; description: (name: string) => string; label: string; destructive: boolean }
> = {
  deactivate: {
    title: '¿Desactivar este usuario?',
    description: (name) =>
      `${name} no podrá ingresar y se cerrarán sus sesiones abiertas. Puedes activarlo de nuevo cuando quieras.`,
    label: 'Desactivar',
    destructive: true,
  },
  activate: {
    title: '¿Activar este usuario?',
    description: (name) => `${name} podrá volver a ingresar con su contraseña.`,
    label: 'Activar',
    destructive: false,
  },
  'reset-password': {
    title: '¿Restablecer la contraseña?',
    description: (name) =>
      `Se generará una contraseña temporal para ${name} y se cerrarán sus sesiones abiertas.`,
    label: 'Restablecer',
    destructive: true,
  },
  'reset-pin': {
    title: '¿Restablecer el PIN?',
    description: (name) => `${name} deberá crear un PIN nuevo la próxima vez que ingrese.`,
    label: 'Restablecer PIN',
    destructive: true,
  },
  unlock: {
    title: '¿Desbloquear la cuenta?',
    description: (name) => `${name} podrá intentar ingresar de nuevo de inmediato.`,
    label: 'Desbloquear',
    destructive: false,
  },
};

function UserRow({
  user,
  isSelf,
  onEdit,
  onAction,
}: {
  user: User;
  isSelf: boolean;
  onEdit: () => void;
  onAction: (action: ConfirmAction) => void;
}) {
  const locked = user.lockedUntil !== null;
  return (
    <li className="flex items-center gap-3 px-4 py-3.5">
      <span
        aria-hidden="true"
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-full text-sm font-extrabold',
          user.isActive ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        {initials(user.name)}
      </span>
      <div className="grid min-w-0 flex-1 gap-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('font-extrabold', !user.isActive && 'text-muted-foreground')}>
            {user.name}
          </span>
          {isSelf ? <Badge tone="neutral">Tú</Badge> : null}
          <Badge tone={user.role === 'ADMIN' ? 'primary' : 'accent'}>
            {USER_ROLE_LABELS[user.role]}
          </Badge>
          {user.isActive ? null : <Badge tone="neutral">Inactivo</Badge>}
          {locked ? <Badge tone="danger">Bloqueado</Badge> : null}
          {user.isActive && user.mustChangePassword ? (
            <Badge tone="pending">Contraseña temporal</Badge>
          ) : null}
          {user.isActive && !user.hasPin && !user.mustChangePassword ? (
            <Badge tone="pending">Sin PIN</Badge>
          ) : null}
        </p>
        <p className="text-sm break-words text-muted-foreground">
          @{user.username}
          {user.email === null ? '' : ` · ${user.email}`}
          {' · '}
          {user.lastLoginAt === null
            ? 'Nunca ha ingresado'
            : `Último ingreso: ${formatDateTimeCO(new Date(user.lastLoginAt))}`}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Acciones para ${user.name}`}>
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden="true" /> Editar datos
          </DropdownMenuItem>
          {locked ? (
            <DropdownMenuItem
              onSelect={() => {
                onAction('unlock');
              }}
            >
              <LockOpen aria-hidden="true" /> Desbloquear cuenta
            </DropdownMenuItem>
          ) : null}
          {isSelf ? null : (
            <>
              <DropdownMenuItem
                onSelect={() => {
                  onAction('reset-password');
                }}
              >
                <RotateCcw aria-hidden="true" /> Restablecer contraseña
              </DropdownMenuItem>
              {user.hasPin ? (
                <DropdownMenuItem
                  onSelect={() => {
                    onAction('reset-pin');
                  }}
                >
                  <KeyRound aria-hidden="true" /> Restablecer PIN
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              {user.isActive ? (
                <DropdownMenuItem
                  destructive
                  onSelect={() => {
                    onAction('deactivate');
                  }}
                >
                  <UserX aria-hidden="true" /> Desactivar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onSelect={() => {
                    onAction('activate');
                  }}
                >
                  <UserCheck aria-hidden="true" /> Activar
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function UsersPage() {
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);

  const [form, setForm] = useState<{ open: boolean; user?: User }>({ open: false });
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ action: ConfirmAction; user: User } | null>(null);
  const [temporary, setTemporary] = useState<{
    name: string;
    username: string;
    password: string;
  } | null>(null);

  const query = { status, search: debouncedSearch };
  const users = useQuery({
    queryKey: usersKeys.list(query),
    queryFn: ({ signal }) => listUsers(query, signal),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: usersKeys.all });

  const saveUser = useMutation({
    mutationFn: async (
      input: { create: CreateUserRequest } | { id: string; update: UpdateUserRequest },
    ) => {
      if ('create' in input)
        return { kind: 'created' as const, result: await createUser(input.create) };
      return { kind: 'updated' as const, result: await updateUser(input.id, input.update) };
    },
    onSuccess: async (outcome) => {
      setForm({ open: false });
      await refresh();
      if (outcome.kind === 'created') {
        const { user, temporaryPassword } = outcome.result;
        setTemporary({ name: user.name, username: user.username, password: temporaryPassword });
        toast.success(`Usuario ${user.username} creado`);
      } else {
        toast.success('Cambios guardados');
      }
    },
    onError: (error) => {
      setFormError(errorMessage(error));
    },
  });

  const runAction = useMutation({
    mutationFn: async ({ action, user }: { action: ConfirmAction; user: User }) => {
      switch (action) {
        case 'deactivate':
          await setUserStatus(user.id, false);
          return { message: `${user.name} fue desactivado` };
        case 'activate':
          await setUserStatus(user.id, true);
          return { message: `${user.name} fue activado` };
        case 'reset-pin':
          await resetUserPin(user.id);
          return { message: `PIN de ${user.name} restablecido` };
        case 'unlock':
          await unlockUser(user.id);
          return { message: `Cuenta de ${user.name} desbloqueada` };
        case 'reset-password': {
          const { temporaryPassword } = await resetUserPassword(user.id);
          return { message: `Contraseña de ${user.name} restablecida`, temporaryPassword };
        }
      }
    },
    onSuccess: async (outcome, { user }) => {
      setConfirm(null);
      await refresh();
      toast.success(outcome.message);
      if (outcome.temporaryPassword !== undefined) {
        setTemporary({
          name: user.name,
          username: user.username,
          password: outcome.temporaryPassword,
        });
      }
    },
    onError: (error) => {
      setConfirm(null);
      toast.error(errorMessage(error));
    },
  });

  const openForm = (user?: User) => {
    setFormError(null);
    setForm(user === undefined ? { open: true } : { open: true, user });
  };

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description="Crea y administra las cuentas del equipo."
        actions={
          <Button
            onClick={() => {
              openForm();
            }}
          >
            <UserPlus aria-hidden="true" /> Nuevo usuario
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div
          role="radiogroup"
          aria-label="Filtrar por estado"
          className="inline-flex rounded-xl bg-muted p-1"
        >
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              role="radio"
              aria-checked={status === filter.value}
              onClick={() => {
                setStatus(filter.value);
              }}
              className={cn(
                'h-9 rounded-lg px-4 text-sm font-bold transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                status === filter.value
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Buscar por nombre, usuario o correo"
            placeholder="Buscar…"
            className="pl-11"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </div>
      </div>

      {users.isPending ? (
        <Card aria-busy="true" aria-label="Cargando usuarios">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-0"
            >
              <Skeleton className="size-11 rounded-full" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3.5 w-72 max-w-full" />
              </div>
            </div>
          ))}
        </Card>
      ) : users.isError ? (
        <ErrorState
          description={errorMessage(users.error)}
          onRetry={() => {
            void users.refetch();
          }}
        />
      ) : users.data.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No hay usuarios con estos filtros"
          description={
            search === ''
              ? 'Crea el primero con el botón "Nuevo usuario".'
              : 'Prueba con otra búsqueda.'
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {users.data.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isSelf={user.id === currentUser.id}
                onEdit={() => {
                  openForm(user);
                }}
                onAction={(action) => {
                  setConfirm({ action, user });
                }}
              />
            ))}
          </ul>
        </Card>
      )}

      {form.open ? (
        <UserFormDialog
          key={form.user?.id ?? 'nuevo'}
          open
          onOpenChange={(open) => {
            if (!open) setForm({ open: false });
          }}
          {...(form.user === undefined ? {} : { user: form.user })}
          roleLocked={form.user?.id === currentUser.id}
          pending={saveUser.isPending}
          error={formError}
          onSubmitCreate={(input) => {
            setFormError(null);
            saveUser.mutate({ create: input });
          }}
          onSubmitUpdate={(input) => {
            if (form.user === undefined) return;
            setFormError(null);
            saveUser.mutate({ id: form.user.id, update: input });
          }}
        />
      ) : null}

      {confirm === null ? null : (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirm(null);
          }}
          title={CONFIRM_TEXT[confirm.action].title}
          description={CONFIRM_TEXT[confirm.action].description(confirm.user.name)}
          confirmLabel={CONFIRM_TEXT[confirm.action].label}
          destructive={CONFIRM_TEXT[confirm.action].destructive}
          pending={runAction.isPending}
          onConfirm={() => {
            runAction.mutate(confirm);
          }}
        />
      )}

      {temporary === null ? null : (
        <TemporaryPasswordDialog
          open
          onOpenChange={(open) => {
            if (!open) setTemporary(null);
          }}
          name={temporary.name}
          username={temporary.username}
          temporaryPassword={temporary.password}
        />
      )}
    </div>
  );
}
