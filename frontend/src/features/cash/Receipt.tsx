import type { Receipt } from '@panesypan/shared';
import { Camera } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getApiBaseUrl } from '@/lib/api-client';
import { errorMessage } from '@/lib/api-errors';
import { resizeImage } from '@/lib/image-resize';

/** URL completa de la foto (Cloudinary llega completa; la de MongoDB, como ruta de la API). */
function receiptUrl(receipt: Receipt): string {
  return receipt.url.startsWith('https://') ? receipt.url : `${getApiBaseUrl()}${receipt.url}`;
}

/** Miniatura de la foto del comprobante; abre la foto completa en otra pestaña. */
export function ReceiptThumb({ receipt }: { receipt: Receipt | null }) {
  if (receipt === null) return null;
  const url = receiptUrl(receipt);
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-block shrink-0"
      title="Ver comprobante"
    >
      <img
        src={url}
        alt="Comprobante"
        className="size-10 rounded-lg border border-border object-cover"
      />
    </a>
  );
}

interface AttachReceiptButtonProps {
  hasReceipt: boolean;
  upload: (image: Blob) => Promise<unknown>;
  onDone?: () => void;
}

/** Botón para tomar o elegir la foto del comprobante; la reduce antes de subirla. */
export function AttachReceiptButton({ hasReceipt, upload, onDone }: AttachReceiptButtonProps) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      await upload(await resizeImage(file));
      toast.success('Comprobante guardado');
      onDone?.();
    } catch (failure) {
      toast.error(failure instanceof Error ? errorMessage(failure) : 'No se pudo subir la foto.');
    } finally {
      setBusy(false);
      if (input.current !== null) input.current.value = '';
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void handleFile(file);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <Camera aria-hidden="true" /> {busy ? 'Subiendo…' : hasReceipt ? 'Cambiar foto' : 'Foto'}
      </Button>
    </>
  );
}
