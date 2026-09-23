import { AUTH_POLICY, passwordProblem } from '@panesypan/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { Spinner } from '@/components/feedback';
import { PasswordInput } from '@/components/PasswordInput';
import { Button } from '@/components/ui/button';
import { fieldAria } from '@/components/ui/field-aria';
import { Field } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';
import { ApiError, errorMessage } from '@/lib/api-errors';
import { changePassword } from '../auth/auth.api';

type Errors = Partial<Record<'currentPassword' | 'newPassword' | 'confirm', string>>;

interface ChangePasswordFormProps {
  username: string;
  /** Texto de la etiqueta de la contraseña actual (en el primer ingreso es la temporal). */
  currentLabel?: string;
  submitLabel?: string;
  onDone?: () => void;
}

export function ChangePasswordForm({
  username,
  currentLabel = 'Contraseña actual',
  submitLabel = 'Guardar contraseña',
  onDone,
}: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      onDone?.();
    },
    onError: (error) => {
      if (error instanceof ApiError) setErrors(error.fieldErrors());
    },
  });

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Errors = {};
    if (currentPassword.length === 0) next.currentPassword = 'Escribe tu contraseña actual';
    const problem = passwordProblem(newPassword, username);
    if (problem !== null) next.newPassword = problem;
    else if (newPassword === currentPassword) next.newPassword = 'Debe ser diferente a la actual';
    if (confirm !== newPassword) next.confirm = 'Las contraseñas no coinciden';
    setErrors(next);
    if (Object.keys(next).length === 0) mutation.mutate({ currentPassword, newPassword });
  };

  return (
    <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
      <Field id="current-password" label={currentLabel} error={errors.currentPassword}>
        <PasswordInput
          {...fieldAria('current-password', errors.currentPassword)}
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => {
            setCurrentPassword(event.target.value);
          }}
        />
      </Field>
      <Field
        id="new-password"
        label="Nueva contraseña"
        error={errors.newPassword}
        hint={`Mínimo ${String(AUTH_POLICY.passwordMinLength)} caracteres. Puede ser una frase, por ejemplo: "pan caliente a las 6".`}
      >
        <PasswordInput
          {...fieldAria('new-password', errors.newPassword, true)}
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => {
            setNewPassword(event.target.value);
          }}
        />
      </Field>
      <Field id="confirm-password" label="Repite la nueva contraseña" error={errors.confirm}>
        <PasswordInput
          {...fieldAria('confirm-password', errors.confirm)}
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => {
            setConfirm(event.target.value);
          }}
        />
      </Field>

      {mutation.isError &&
      !(
        mutation.error instanceof ApiError && Object.keys(mutation.error.fieldErrors()).length > 0
      ) ? (
        <Alert tone="danger">{errorMessage(mutation.error)}</Alert>
      ) : null}
      {mutation.isSuccess && onDone === undefined ? (
        <Alert tone="success">
          Contraseña actualizada. Se cerraron tus sesiones en otros dispositivos.
        </Alert>
      ) : null}

      <Button type="submit" size="lg" disabled={mutation.isPending}>
        {mutation.isPending ? <Spinner /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}
