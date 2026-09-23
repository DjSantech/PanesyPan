import {
  createUserRequestSchema,
  removeAccents,
  USER_ROLE_LABELS,
  USER_ROLES,
  type CreateUserRequest,
  type UpdateUserRequest,
  type User,
  type UserRole,
} from '@panesypan/shared';
import { useState, type SubmitEvent } from 'react';
import { Spinner } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { fieldAria } from '@/components/ui/field-aria';
import { Field, Input, NativeSelect } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';

type Errors = Partial<Record<'name' | 'username' | 'email' | 'role', string>>;

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sin usuario = crear; con usuario = editar. */
  user?: User;
  /** No se puede cambiar el propio rol. */
  roleLocked?: boolean;
  pending: boolean;
  error: string | null;
  onSubmitCreate: (input: CreateUserRequest) => void;
  onSubmitUpdate: (input: UpdateUserRequest) => void;
}

/** Sugerencia de usuario a partir del nombre: "Laura Gómez" → "laura.gomez". */
function suggestUsername(name: string): string {
  const parts = removeAccents(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts.at(-1) : undefined;
  return (last === undefined ? first : `${first}.${last}`).slice(0, 32);
}

export function UserFormDialog({
  open,
  onOpenChange,
  user,
  roleLocked = false,
  pending,
  error,
  onSubmitCreate,
  onSubmitUpdate,
}: UserFormDialogProps) {
  const editing = user !== undefined;
  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [usernameTouched, setUsernameTouched] = useState(editing);
  const [email, setEmail] = useState(user?.email ?? '');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'CASHIER');
  const [errors, setErrors] = useState<Errors>({});

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();
    const parsed = createUserRequestSchema.safeParse({
      name,
      username: editing ? user.username : username,
      role,
      ...(trimmedEmail === '' ? {} : { email: trimmedEmail }),
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (
          (key === 'name' || key === 'username' || key === 'email' || key === 'role') &&
          next[key] === undefined
        ) {
          next[key] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    if (!editing) {
      onSubmitCreate(parsed.data);
      return;
    }
    const changes: UpdateUserRequest = {};
    if (parsed.data.name !== user.name) changes.name = parsed.data.name;
    const newEmail = parsed.data.email ?? null;
    if (newEmail !== user.email) changes.email = newEmail;
    if (!roleLocked && parsed.data.role !== user.role) changes.role = parsed.data.role;
    if (Object.keys(changes).length === 0) {
      onOpenChange(false);
      return;
    }
    onSubmitUpdate(changes);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={editing ? 'Editar usuario' : 'Nuevo usuario'}
        description={
          editing
            ? `@${user.username}`
            : 'Se generará una contraseña temporal que la persona cambiará en su primer ingreso.'
        }
      >
        <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
          <Field id="user-name" label="Nombre completo" error={errors.name}>
            <Input
              {...fieldAria('user-name', errors.name)}
              autoComplete="off"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (!usernameTouched) setUsername(suggestUsername(event.target.value));
              }}
            />
          </Field>

          {editing ? null : (
            <Field
              id="user-username"
              label="Usuario para ingresar"
              error={errors.username}
              hint="Minúsculas, sin tildes ni espacios. Ej.: laura.gomez"
            >
              <Input
                {...fieldAria('user-username', errors.username, true)}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(event) => {
                  setUsernameTouched(true);
                  setUsername(event.target.value.toLowerCase());
                }}
              />
            </Field>
          )}

          <Field id="user-email" label="Correo (opcional)" error={errors.email}>
            <Input
              {...fieldAria('user-email', errors.email)}
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </Field>

          <Field
            id="user-role"
            label="Rol"
            error={errors.role}
            hint={roleLocked ? 'No puedes cambiar tu propio rol.' : undefined}
          >
            <NativeSelect
              {...fieldAria('user-role', errors.role, roleLocked)}
              value={role}
              disabled={roleLocked}
              onChange={(event) => {
                setRole(event.target.value as UserRole);
              }}
            >
              {USER_ROLES.map((option) => (
                <option key={option} value={option}>
                  {USER_ROLE_LABELS[option]}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {error === null ? null : <Alert tone="danger">{error}</Alert>}

          <DialogFooter className="mt-1">
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {editing ? 'Guardar cambios' : 'Crear usuario'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
