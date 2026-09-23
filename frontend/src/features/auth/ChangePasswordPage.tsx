import { useNavigate } from 'react-router';
import { Alert } from '@/components/ui/surface';
import { ChangePasswordForm } from '../account/ChangePasswordForm';
import { AuthCardLayout } from './AuthCardLayout';
import { useCurrentUser } from './use-session';

/** Primer ingreso (o contraseña restablecida): hay que reemplazar la contraseña temporal. */
export function ChangePasswordPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();

  return (
    <AuthCardLayout title="Nueva contraseña" description={`Hola, ${user.name}.`}>
      <div className="grid gap-4">
        <Alert tone="info">
          Por seguridad, cambia la contraseña temporal por una que solo tú conozcas.
        </Alert>
        <ChangePasswordForm
          username={user.username}
          currentLabel="Contraseña temporal"
          submitLabel="Guardar y continuar"
          onDone={() => {
            void navigate('/', { replace: true });
          }}
        />
      </div>
    </AuthCardLayout>
  );
}
