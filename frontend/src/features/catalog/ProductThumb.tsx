import { Croissant } from 'lucide-react';
import { cn } from '@/lib/utils';
import { productImageUrl } from './catalog.api';

/** Foto del producto (o un ícono si no tiene). Carga diferida: el catálogo puede ser largo. */
export function ProductThumb({
  imagePath,
  name,
  className,
}: {
  imagePath: string | null;
  name: string;
  className?: string;
}) {
  const url = productImageUrl(imagePath);
  return (
    <div
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-xl bg-muted',
        className,
      )}
    >
      {url === null ? (
        <Croissant className="size-1/2 text-muted-foreground/60" aria-hidden="true" />
      ) : (
        <img
          src={url}
          alt={name}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      )}
    </div>
  );
}
