import { useState } from 'react';
import { PinPad } from '@/components/PinPad';
import { Spinner } from '@/components/feedback';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export interface ApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  error: string | null;
  onSubmit: (pin: string) => void;
  description?: string;
}

/** El administrador digita su PIN en la tablet de la cajera para autorizar la operación. */
export function ApprovalDialog({
  open,
  onOpenChange,
  pending,
  error,
  onSubmit,
  description = 'Pide a un administrador que digite su PIN.',
}: ApprovalDialogProps) {
  const [pin, setPin] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setPin('');
        onOpenChange(next);
      }}
    >
      <DialogContent title="Autorización del administrador" description={description}>
        <div className="grid justify-items-center gap-3 pb-2">
          <PinPad
            label="PIN del administrador"
            value={pin}
            onChange={setPin}
            disabled={pending}
            error={error}
            onComplete={(value) => {
              setPin('');
              onSubmit(value);
            }}
          />
          {pending ? <Spinner label="Verificando…" /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
