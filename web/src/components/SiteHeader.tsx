'use client';

import { Menu, X } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { NAV_ITEMS } from './nav-items';

export function SiteHeader({ businessName }: { businessName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = NAV_ITEMS.map((item) => {
    const exact = pathname === item.href;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={exact ? 'page' : undefined}
          onClick={() => setOpen(false)}
          className={`block rounded-md px-3 py-2 font-semibold transition-colors hover:bg-muted ${
            exact ? 'text-primary' : 'text-foreground'
          }`}
        >
          {item.label}
        </Link>
      </li>
    );
  });

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
        <Link href="/" className="flex items-center gap-3 rounded-md">
          <Image
            src="/logo-panesypan-320.webp"
            alt=""
            width={48}
            height={48}
            className="size-12 rounded-full"
            priority
          />
          <span className="font-display text-xl font-bold">{businessName}</span>
        </Link>
        <nav aria-label="Principal" className="hidden md:block">
          <ul className="flex items-center gap-1">{links}</ul>
        </nav>
        <button
          type="button"
          className="rounded-md p-2 hover:bg-muted md:hidden"
          aria-expanded={open}
          aria-controls="menu-movil"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X aria-hidden className="size-6" /> : <Menu aria-hidden className="size-6" />}
        </button>
      </div>
      {open && (
        <nav id="menu-movil" aria-label="Principal (móvil)" className="border-t md:hidden">
          <ul className="mx-auto flex max-w-6xl flex-col px-4 py-2">{links}</ul>
        </nav>
      )}
    </header>
  );
}
