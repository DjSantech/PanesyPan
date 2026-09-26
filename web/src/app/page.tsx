import { ProductCard } from '@/components/ProductCard';
import { getCatalog } from '@/lib/api';
import { getContactInfo } from '@/lib/business';
import { ArrowRight, MessageCircle, UtensilsCrossed } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { pageMetadata } from '@/lib/seo/site';

export const metadata = pageMetadata({
  title: 'Panadería en Dosquebradas',
  description:
    'Pan fresco todos los días, productos de panadería y menú del día en Dosquebradas, Risaralda. Pide por WhatsApp.',
  path: '/',
});

export default async function HomePage() {
  const [catalog, contact] = await Promise.all([getCatalog(), getContactInfo()]);
  const featured = catalog.categories
    .flatMap((c) => c.products)
    .filter((p) => p.isAvailable)
    .slice(0, 4);

  return (
    <>
      <section className="grid items-center gap-8 rounded-2xl bg-card p-6 shadow-sm sm:p-10 md:grid-cols-[1fr_auto]">
        <div>
          <p className="font-semibold text-primary">Panadería en {contact.city}</p>
          <h1 className="mt-2 text-4xl font-bold sm:text-5xl">{contact.name}</h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">
            Pan fresco todos los días y almuerzo casero con menú del día.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/menu"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-bold text-primary-foreground hover:opacity-90"
            >
              Ver el menú <ArrowRight aria-hidden className="size-5" />
            </Link>
            <Link
              href="/menu-del-dia"
              className="inline-flex items-center gap-2 rounded-lg border-2 border-primary px-5 py-3 font-bold text-primary hover:bg-muted"
            >
              <UtensilsCrossed aria-hidden className="size-5" /> Menú del día
            </Link>
            {contact.whatsappUrl && (
              <a
                href={contact.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-success px-5 py-3 font-bold text-success-soft hover:opacity-90"
              >
                <MessageCircle aria-hidden className="size-5" /> Escríbenos por WhatsApp
              </a>
            )}
          </div>
        </div>
        <Image
          src="/logo-panesypan-320.webp"
          alt={`Logo de ${contact.name}`}
          width={240}
          height={240}
          className="mx-auto size-48 rounded-full sm:size-60"
          priority
        />
      </section>

      {featured.length > 0 && (
        <section aria-labelledby="destacados" className="mt-12">
          <div className="mb-6 flex items-end justify-between gap-4">
            <h2 id="destacados" className="text-2xl font-bold sm:text-3xl">
              De nuestro horno
            </h2>
            <Link href="/menu" className="font-semibold text-primary hover:underline">
              Ver todo
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
