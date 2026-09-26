import { resolveImageUrl } from '@/lib/api';
import type { CatalogProduct } from '@/lib/types';
import { formatCOP } from '@panesypan/shared';
import { Croissant } from 'lucide-react';
import Image from 'next/image';
import type { ReactNode } from 'react';

interface ProductCardProps {
  product: CatalogProduct;
  /** Espacio para acciones (p. ej. el botón "Agregar" del carrito). */
  action?: ReactNode;
}

export function ProductCard({ product, action }: ProductCardProps) {
  const src = resolveImageUrl(product.imageUrl);
  return (
    <article className="flex flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="relative aspect-[4/3] bg-muted">
        {src ? (
          <Image
            src={src}
            alt={product.name}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
            className={`object-cover ${product.isAvailable ? '' : 'opacity-60 grayscale'}`}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Croissant aria-hidden className="size-12" />
          </div>
        )}
        {!product.isAvailable && (
          <span className="absolute top-2 left-2 rounded-full bg-danger-soft px-3 py-1 text-sm font-bold text-danger">
            Agotado hoy
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="text-lg font-bold">{product.name}</h3>
        {product.description && (
          <p className="text-sm text-muted-foreground">{product.description}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <p className="text-lg font-bold text-primary">{formatCOP(product.price)}</p>
          {action}
        </div>
      </div>
    </article>
  );
}
