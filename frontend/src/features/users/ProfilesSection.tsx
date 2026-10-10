import {
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVELS,
  moduleLevel,
  PERMISSION_MODULES,
  permissionsFromLevels,
  USER_ROLE_LABELS,
  type AccessLevel,
  type Profile,
  type User,
} from '@panesypan/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Alert, Badge, Card, Skeleton } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/utils';
import {
  createProfile,
  profilesKeys,
  setUserProfile,
  updateProfile,
  useProfiles,
} from './profiles.api';
import { usersKeys } from './users.api';

type Levels = Record<string, AccessLevel>;

const levelsOf = (permissions: Profile['permissions']): Levels =>
  Object.fromEntries(PERMISSION_MODULES.map((m) => [m.key, moduleLevel(m, permissions)]));

/** Lista de perfiles con su matriz de permisos por módulo. */
export function ProfilesSection() {
  const profiles = useProfiles();
  const [editing, setEditing] = useState<{ profile?: Profile } | null>(null);

  return (
    <section className="mt-10 grid gap-4" aria-labelledby="perfiles-titulo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="perfiles-titulo" className="text-xl font-extrabold">
            Perfiles de permisos
          </h2>
          <p className="text-sm text-muted-foreground">
            Define qué puede hacer cada persona por módulo. Los administradores siempre tienen todos
            los permisos.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setEditing({});
          }}
        >
          <Plus aria-hidden="true" /> Nuevo perfil
        </Button>
      </div>

      {profiles.isPending ? (
        <Skeleton className="h-32" />
      ) : profiles.isError ? (
        <ErrorState
          description={errorMessage(profiles.error)}
          onRetry={() => {
            void profiles.refetch();
          }}
        />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {profiles.data.map((profile) => (
              <li key={profile.id} className="flex items-center gap-3 px-4 py-3.5">
                <ShieldCheck aria-hidden="true" className="size-5 shrink-0 text-primary" />
                <div className="grid min-w-0 flex-1 gap-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn('font-extrabold', !profile.isActive && 'text-muted-foreground')}
                    >
                      {profile.name}
                    </span>
                    {profile.isSystem ? <Badge tone="neutral">Del sistema</Badge> : null}
                    {profile.isActive ? null : <Badge tone="neutral">Inactivo</Badge>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {PERMISSION_MODULES.filter(
                      (m) => moduleLevel(m, profile.permissions) !== 'NONE',
                    )
                      .map((m) => m.label)
                      .join(' · ') || 'Sin permisos'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={profile.isEditable ? `Editar ${profile.name}` : `Ver ${profile.name}`}
                  onClick={() => {
                    setEditing({ profile });
                  }}
                >
                  <Pencil />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing === null ? null : (
        <ProfileDialog
          key={editing.profile?.id ?? 'nuevo'}
          {...(editing.profile === undefined ? {} : { profile: editing.profile })}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function ProfileDialog({ profile, onClose }: { profile?: Profile; onClose: () => void }) {
  const queryClient = useQueryClient();
  const readOnly = profile !== undefined && !profile.isEditable;
  const [name, setName] = useState(profile?.name ?? '');
  const [isActive, setIsActive] = useState(profile?.isActive ?? true);
  const [levels, setLevels] = useState<Levels>(() => levelsOf(profile?.permissions ?? []));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const permissions = permissionsFromLevels(levels);
      if (profile === undefined) return createProfile({ name, permissions });
      return updateProfile(profile.id, {
        name,
        permissions,
        ...(profile.isSystem ? {} : { isActive }),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: profilesKeys.all });
      toast.success(profile === undefined ? 'Perfil creado' : 'Perfil guardado');
      onClose();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={profile === undefined ? 'Nuevo perfil' : profile.name}
        description="Elige el nivel de acceso de cada módulo."
        className="sm:max-w-2xl"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          {readOnly ? (
            <Alert tone="pending">
              El perfil Administrador siempre tiene todos los permisos y no se puede modificar.
            </Alert>
          ) : (
            <Field id="profile-name" label="Nombre">
              <Input
                id="profile-name"
                value={name}
                maxLength={40}
                required
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </Field>
          )}

          <div className="max-h-[50vh] overflow-y-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-bold">
                    Módulo
                  </th>
                  {ACCESS_LEVELS.map((level) => (
                    <th key={level} scope="col" className="px-2 py-2 text-center font-bold">
                      {ACCESS_LEVEL_LABELS[level]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {PERMISSION_MODULES.map((module) => (
                  <tr key={module.key}>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="block font-bold">{module.label}</span>
                      <span className="block text-xs text-muted-foreground">{module.hint}</span>
                    </th>
                    {ACCESS_LEVELS.map((level) => {
                      const available = level !== 'READ' || module.read !== null;
                      return (
                        <td key={level} className="px-2 py-2 text-center">
                          {available ? (
                            <input
                              type="radio"
                              className="size-5 accent-primary"
                              name={`nivel-${module.key}`}
                              aria-label={`${module.label}: ${ACCESS_LEVEL_LABELS[level]}`}
                              checked={levels[module.key] === level}
                              disabled={readOnly}
                              onChange={() => {
                                setLevels((current) => ({ ...current, [module.key]: level }));
                              }}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {profile !== undefined && !profile.isSystem ? (
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={isActive}
                onChange={(event) => {
                  setIsActive(event.target.checked);
                }}
              />
              Perfil activo (si se desactiva, sus usuarios vuelven al perfil de su rol)
            </label>
          ) : null}

          {error === null ? null : <Alert tone="danger">{error}</Alert>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {readOnly ? 'Cerrar' : 'Cancelar'}
            </Button>
            {readOnly ? null : (
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Guardando…' : 'Guardar perfil'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Asigna a un usuario uno de los perfiles activos, o el de su rol. */
export function AssignProfileDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const queryClient = useQueryClient();
  const profiles = useProfiles();
  const [value, setValue] = useState(user.profileId ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => setUserProfile(user.id, value === '' ? null : value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: usersKeys.all });
      toast.success(`Perfil de ${user.name} actualizado`);
      onClose();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title="Cambiar perfil" description={`¿Qué puede hacer ${user.name}?`}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          {user.role === 'ADMIN' ? (
            <Alert tone="pending">
              Es administrador: conserva todos los permisos aunque tenga otro perfil asignado.
            </Alert>
          ) : null}
          <Field id="user-profile" label="Perfil">
            <NativeSelect
              id="user-profile"
              value={value}
              disabled={profiles.isPending}
              onChange={(event) => {
                setValue(event.target.value);
              }}
            >
              <option value="">{USER_ROLE_LABELS[user.role]} (por defecto de su rol)</option>
              {(profiles.data ?? [])
                .filter((p) => p.isActive && !p.isSystem)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          {error === null ? null : <Alert tone="danger">{error}</Alert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
