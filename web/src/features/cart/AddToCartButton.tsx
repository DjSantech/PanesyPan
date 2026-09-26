'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { addToCart } from './cart-store';

export function AddToCartButton({
  product,
}: {
  product: { id: string; name: string; price: number };
}) {
  const [added, setAdded] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        addToCart(product);
        setAdded(true);
        window.setTimeout(() => setAdded(false), 1200);
      }}
      className="inline-flex min-h-11 items-center gap-1 rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-label={`Agregar ${product.name} al pedido`}
    >
      <Plus aria-hidden className="size-4" />
      <span aria-live="polite">{added ? 'Agregado' : 'Agregar'}</span>
    </button>
  );
}
