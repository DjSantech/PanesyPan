import { useState } from 'react';
import { ApiError } from '@/lib/api-errors';
import type { ApprovalDialogProps } from './ApprovalDialog';

function pinErrorMessage(error: ApiError): string {
  const details = error.details;
  const remaining =
    details !== null && typeof details === 'object' && 'remainingAttempts' in details
      ? details.remainingAttempts
      : null;
  return typeof remaining === 'number'
    ? `PIN incorrecto. Quedan ${String(remaining)} ${remaining === 1 ? 'intento' : 'intentos'}.`
    : error.message;
}

interface ApprovedActionOptions<T> {
  /** Ejecuta la operación; `pin` llega cuando un administrador lo digitó. */
  run: (pin: string | undefined) => Promise<T>;
  onSuccess: (result: T) => void;
  onError: (error: unknown) => void;
}

/**
 * Ejecuta una operación que puede necesitar autorización: si la API responde que falta
 * (o que el PIN no sirvió), abre el teclado del PIN y reintenta con él.
 */
export function useApprovedAction<T>({ run, onSuccess, onError }: ApprovedActionOptions<T>) {
  const [asking, setAsking] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const execute = async (pin?: string) => {
    setPending(true);
    try {
      const result = await run(pin);
      setAsking(false);
      setPinError(null);
      onSuccess(result);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'APPROVAL_REQUIRED') {
        setPinError(null);
        setAsking(true);
      } else if (error instanceof ApiError && error.code === 'INVALID_PIN') {
        setPinError(pinErrorMessage(error));
        setAsking(true);
      } else {
        setAsking(false);
        onError(error);
      }
    } finally {
      setPending(false);
    }
  };

  return {
    pending,
    execute: (pin?: string) => {
      void execute(pin);
    },
    /** Abre el teclado sin esperar a la API (cuando ya se sabe que hace falta). */
    askForPin: () => {
      setPinError(null);
      setAsking(true);
    },
    approvalProps: {
      open: asking,
      onOpenChange: setAsking,
      pending,
      error: pinError,
      onSubmit: (pin: string) => {
        void execute(pin);
      },
    } satisfies ApprovalDialogProps,
  };
}
