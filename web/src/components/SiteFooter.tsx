import { negocio } from '@/config/negocio';
import type { ContactInfo } from '@/lib/business';
import Link from 'next/link';
import { NAV_ITEMS } from './nav-items';

export function SiteFooter({ contact }: { contact: ContactInfo }) {
  const socials = [
    { href: negocio.instagram, label: 'Instagram' },
    { href: negocio.facebook, label: 'Facebook' },
    { href: negocio.tiktok, label: 'TikTok' },
  ].filter((s) => s.href);

  return (
    <footer className="mt-16 border-t bg-muted">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <p className="font-display text-lg font-bold">{contact.name}</p>
          <p className="text-muted-foreground">Panadería en {contact.city}</p>
          {contact.address && <p className="mt-2">{contact.address}</p>}
          {contact.phoneUrl && (
            <p>
              <a href={contact.phoneUrl} className="underline underline-offset-4">
                {contact.phone}
              </a>
            </p>
          )}
        </div>
        <nav aria-label="Pie de página">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="hover:underline">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {socials.length > 0 && (
          <ul className="space-y-1">
            {socials.map((s) => (
              <li key={s.label}>
                <a
                  href={s.href}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="hover:underline"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="border-t px-4 py-4 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} {contact.name}
      </p>
    </footer>
  );
}
