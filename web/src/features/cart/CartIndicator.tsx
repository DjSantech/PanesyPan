'use client';

import { ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { cartCount, useCart } from './cart-store';

export function CartIndicator() {
  const count = cartCount(useCart());
  return (
    <Link
      href="/pedido"
      className="relative inline-flex items-center rounded-md p-2 hover:bg-muted"
      aria-label={count > 0 ? `Tu pedido: ${String(count)} productos` : 'Tu pedido (vacío)'}
    >
      <ShoppingBag aria-hidden className="size-6" />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
