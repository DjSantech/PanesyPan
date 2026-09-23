import { pinProblem } from '@panesypan/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Spinner } from '@/components/feedback';
import { PinPad } from '@/components/PinPad';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api-errors';
import { setPin } from './auth.api';
import { AuthCardLayout } from './AuthCardLayout';

type Step = 'create' | 'confirm';

/** Creación del PIN de 6 dígitos (para desbloquear la pantalla). Se escribe dos veces. */
export function SetPinPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('create');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const restart = (message: string) => {
    setStep('create');
    setFirst('');
    setValue('');
    setError(message);
  };

  const mutation = useMutation({
    mutationFn: (pin: string) => setPin({ pin }),
    onSuccess: () => {
      void navigate('/', { replace: true });
    },
    onError: (saveError) => {
      restart(errorMessage(saveError));
    },
  });

  const handleComplete = (pin: string) => {
    if (step === 'create') {
      const problem = pinProblem(pin);
      if (problem !== null) {
        setValue('');
        setError(problem);
        return;
      }
      setFirst(pin);
      setValue('');
      setError(null);
      setStep('confirm');
      return;
    }
    if (pin !== first) {
      restart('Los PIN no coinciden. Empecemos de nuevo.');
      return;
    }
    mutation.mutate(pin);
  };

  return (
    <AuthCardLayout
      title={step === 'create' ? 'Crea tu PIN' : 'Confirma tu PIN'}
      description={
        step === 'create'
          ? 'Con estos 6 números desbloquearás la pantalla cuando quede inactiva.'
          : 'Escribe el mismo PIN otra vez.'
      }
    >
      <div className="flex flex-col items-center gap-4">
        <PinPad
          key={step}
          label={step === 'create' ? 'Nuevo PIN de 6 dígitos' : 'Confirmar PIN'}
          value={value}
          onChange={(next) => {
            setValue(next);
            if (error !== null && next.length > 0) setError(null);
          }}
          onComplete={handleComplete}
          disabled={mutation.isPending}
          error={error}
        />
        {mutation.isPending ? (
          <Spinner label="Guardando PIN…" className="text-muted-foreground" />
        ) : null}
        {step === 'confirm' ? (
          <Button
            variant="ghost"
            onClick={() => {
              restart('');
            }}
          >
            Volver a empezar
          </Button>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Evita fechas, secuencias (123456) y números repetidos.
          </p>
        )}
      </div>
    </AuthCardLayout>
  );
}
