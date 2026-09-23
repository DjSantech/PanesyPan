import { useMutation } from '@tanstack/react-query';
import { LockKeyhole, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { BrandLogo } from '@/components/BrandLogo';
import { Spinner } from '@/components/feedback';
import { PinPad } from '@/components/PinPad';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/surface';
import { errorMessage } from '@/lib/api-errors';
import { logout, unlockSession } from './auth.api';
import { useCurrentUser } from './use-session';

/**
 * Pantalla de bloqueo: cubre todo (no deja ver ventas ni datos) y se desbloquea con el PIN.
 * El carrito y lo que había en pantalla se conservan debajo.
 */
export function LockScreen() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noPin, setNoPin] = useState<string | null>(
    user.hasPin ? null : 'No tienes un PIN configurado. Ingresa de nuevo con tu contraseña.',
  );

  const signOut = async (notice?: string) => {
    await logout();
    void navigate('/ingresar', { replace: true, state: notice === undefined ? {} : { notice } });
  };

  const unlock = useMutation({
    mutationFn: unlockSession,
    onSuccess: async (outcome) => {
      setPin('');
      if (outcome.status === 'wrong-pin') setError(outcome.message);
      if (outcome.status === 'no-pin') setNoPin(outcome.message);
      if (outcome.status === 'signed-out') await signOut(outcome.message);
    },
    onError: (unlockError) => {
      setPin('');
      setError(errorMessage(unlockError));
    },
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      className="fixed inset-0 z-60 flex items-center justify-center overflow-y-auto bg-background px-4 py-8"
    >
      <div className="flex w-full max-w-xs flex-col items-center gap-5 text-center">
        <BrandLogo size={88} />
        <div className="grid gap-1">
          <h1
            id="lock-title"
            className="flex items-center justify-center gap-2 font-display text-2xl font-bold"
          >
            <LockKeyhole className="size-6 text-primary" aria-hidden="true" />
            Pantalla bloqueada
          </h1>
          <p className="text-muted-foreground">{user.name}, ingresa tu PIN para continuar.</p>
        </div>

        {noPin === null ? (
          <PinPad
            label="PIN de 6 dígitos"
            value={pin}
            onChange={(value) => {
              setPin(value);
              if (error !== null) setError(null);
            }}
            onComplete={(value) => {
              unlock.mutate(value);
            }}
            disabled={unlock.isPending}
            error={error}
          />
        ) : (
          <Alert tone="pending">{noPin}</Alert>
        )}

        {unlock.isPending ? (
          <Spinner label="Verificando PIN…" className="text-muted-foreground" />
        ) : null}

        <Button
          variant={noPin === null ? 'ghost' : 'default'}
          onClick={() => {
            void signOut();
          }}
          className="w-full"
        >
          <LogOut aria-hidden="true" />
          {noPin === null
            ? `No soy ${user.name.split(' ')[0] ?? ''} · Cambiar de usuario`
            : 'Ingresar de nuevo'}
        </Button>
      </div>
    </div>
  );
}
