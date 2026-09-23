import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/surface';

interface TemporaryPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  username: string;
  temporaryPassword: string;
}

/** Muestra UNA sola vez la contraseña temporal para entregarla a la persona. */
export function TemporaryPasswordDialog({
  open,
  onOpenChange,
  name,
  username,
  temporaryPassword,
}: TemporaryPasswordDialogProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setCopied(false);
        onOpenChange(next);
      }}
    >
      <DialogContent
        title="Contraseña temporal"
        description={`Entrégasela a ${name}. Al ingresar deberá cambiarla y crear su PIN.`}
      >
        <div className="grid gap-4">
          <dl className="grid gap-3 rounded-2xl bg-muted p-4">
            <div className="grid gap-0.5">
              <dt className="text-xs font-bold text-muted-foreground">Usuario</dt>
              <dd className="text-lg font-extrabold">{username}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-xs font-bold text-muted-foreground">Contraseña temporal</dt>
              <dd className="font-mono text-2xl font-bold tracking-wider select-all">
                {temporaryPassword}
              </dd>
            </div>
          </dl>
          <Alert tone="pending">
            Por seguridad no se volverá a mostrar. Si se pierde, restablece la contraseña de nuevo.
          </Alert>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void copy()}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? 'Copiada' : 'Copiar'}
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Listo, ya la entregué
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
