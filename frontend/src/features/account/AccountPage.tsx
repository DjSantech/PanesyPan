import { pinProblem, USER_ROLE_LABELS } from '@panesypan/shared';
import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { PageHeader, Spinner } from '@/components/feedback';
import { PasswordInput } from '@/components/PasswordInput';
import { Button } from '@/components/ui/button';
import { fieldAria } from '@/components/ui/field-aria';
import { Field } from '@/components/ui/form';
import {
  Alert,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/surface';
import { ApiError, errorMessage } from '@/lib/api-errors';
import { initials } from '@/lib/utils';
import { setPin } from '../auth/auth.api';
import { useCurrentUser } from '../auth/use-session';
import { ChangePasswordForm } from './ChangePasswordForm';

type PinErrors = Partial<Record<'pin' | 'confirm' | 'currentPassword', string>>;

function ChangePinForm({ hasPin }: { hasPin: boolean }) {
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [errors, setErrors] = useState<PinErrors>({});

  const mutation = useMutation({
    mutationFn: setPin,
    onSuccess: () => {
      setPinValue('');
      setConfirm('');
      setCurrentPassword('');
      toast.success('PIN actualizado');
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(error.fieldErrors());
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: PinErrors = {};
    const problem = pinProblem(pin);
    if (problem !== null) next.pin = problem;
    if (confirm !== pin) next.confirm = 'Los PIN no coinciden';
    if (hasPin && currentPassword.length === 0)
      next.currentPassword = 'Escribe tu contraseña actual';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    mutation.mutate(hasPin ? { pin, currentPassword } : { pin });
  };

  const pinInputProps = {
    type: 'password' as const,
    inputMode: 'numeric' as const,
    autoComplete: 'off',
    maxLength: 6,
    pattern: '\\d{6}',
  };

  return (
    <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="new-pin" label="Nuevo PIN (6 números)" error={errors.pin}>
          <PasswordInput
            {...fieldAria('new-pin', errors.pin)}
            {...pinInputProps}
            value={pin}
            onChange={(event) => {
              setPinValue(event.target.value.replace(/\D/g, ''));
            }}
          />
        </Field>
        <Field id="confirm-pin" label="Repite el PIN" error={errors.confirm}>
          <PasswordInput
            {...fieldAria('confirm-pin', errors.confirm)}
            {...pinInputProps}
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value.replace(/\D/g, ''));
            }}
          />
        </Field>
      </div>
      {hasPin ? (
        <Field
          id="pin-current-password"
          label="Tu contraseña actual"
          error={errors.currentPassword}
        >
          <PasswordInput
            {...fieldAria('pin-current-password', errors.currentPassword)}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => {
              setCurrentPassword(event.target.value);
            }}
          />
        </Field>
      ) : null}
      {mutation.isError &&
      !(
        mutation.error instanceof ApiError && Object.keys(mutation.error.fieldErrors()).length > 0
      ) ? (
        <Alert tone="danger">{errorMessage(mutation.error)}</Alert>
      ) : null}
      <Button type="submit" disabled={mutation.isPending} className="justify-self-start">
        {mutation.isPending ? <Spinner /> : <KeyRound aria-hidden="true" />}
        {hasPin ? 'Cambiar PIN' : 'Crear PIN'}
      </Button>
    </form>
  );
}

export function AccountPage() {
  const user = useCurrentUser();

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <PageHeader title="Mi cuenta" description="Tus datos, tu contraseña y tu PIN." />

      <Card>
        <CardContent className="flex items-center gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-primary text-lg font-extrabold text-primary-foreground">
            {initials(user.name)}
          </span>
          <div className="grid min-w-0 gap-0.5">
            <p className="truncate text-lg font-extrabold">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              @{user.username} · {USER_ROLE_LABELS[user.role]}
              {user.email === null ? '' : ` · ${user.email}`}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contraseña</CardTitle>
          <CardDescription>
            Al cambiarla se cierran tus sesiones en otros dispositivos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm username={user.username} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>PIN</CardTitle>
          <CardDescription>
            Sirve para desbloquear la pantalla cuando queda inactiva. No lo compartas con nadie.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePinForm hasPin={user.hasPin} />
        </CardContent>
      </Card>
    </div>
  );
}
