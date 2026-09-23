import { BUSINESS_NAME, loginRequestSchema } from '@panesypan/shared';
import { useMutation } from '@tanstack/react-query';
import { CircleAlert, LogIn } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Spinner } from '@/components/feedback';
import { PasswordInput } from '@/components/PasswordInput';
import { Button } from '@/components/ui/button';
import { fieldAria } from '@/components/ui/field-aria';
import { Field, Input } from '@/components/ui/form';
import { Alert } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { login } from './auth.api';
import { AuthCardLayout } from './AuthCardLayout';
import { useSessionQuery } from './use-session';

interface LocationState {
  from?: string;
  notice?: string;
}

export function LoginPage() {
  const session = useSessionQuery();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: () => {
      void navigate(state.from ?? '/', { replace: true });
    },
  });

  if (session.data !== undefined && session.data !== null) {
    return <Navigate to={state.from ?? '/'} replace />;
  }

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = loginRequestSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      const errors: { identifier?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === 'identifier' || key === 'password') && errors[key] === undefined) {
          errors[key] = issue.message;
        }
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    mutation.mutate(parsed.data);
  };

  return (
    <AuthCardLayout title={BUSINESS_NAME} description="Sistema de punto de venta">
      <form className="grid gap-4" onSubmit={handleSubmit} noValidate>
        {state.notice === undefined ? null : <Alert tone="pending">{state.notice}</Alert>}

        <Field id="identifier" label="Usuario o correo" error={fieldErrors.identifier}>
          <Input
            {...fieldAria('identifier', fieldErrors.identifier)}
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            value={identifier}
            onChange={(event) => {
              setIdentifier(event.target.value);
            }}
          />
        </Field>

        <Field id="password" label="Contraseña" error={fieldErrors.password}>
          <PasswordInput
            {...fieldAria('password', fieldErrors.password)}
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>

        {mutation.isError ? (
          <Alert tone="danger">
            <CircleAlert aria-hidden="true" />
            <span>{errorMessage(mutation.error)}</span>
          </Alert>
        ) : null}

        <Button type="submit" size="lg" className="mt-1 w-full" disabled={mutation.isPending}>
          {mutation.isPending ? <Spinner label="Ingresando…" /> : <LogIn aria-hidden="true" />}
          {mutation.isPending ? 'Ingresando…' : 'Ingresar'}
        </Button>
      </form>
    </AuthCardLayout>
  );
}
