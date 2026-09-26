import { PageHeading } from '@/components/PageHeading';
import { ProductCard } from '@/components/ProductCard';
import { getCatalog } from '@/lib/api';
import { pageMetadata } from '@/lib/seo/site';

export const metadata = pageMetadata({
  title: 'Menú y precios',
  description:
    'Pan, productos de panadería y bebidas con precios en pesos. Tu panadería de confianza en Dosquebradas.',
  path: '/menu',
});

export default async function MenuPage() {
  const { categories } = await getCatalog();

  return (
    <>
      <PageHeading title="Nuestro menú">Precios en pesos colombianos, IVA incluido.</PageHeading>
      {categories.length === 0 ? (
        <p className="text-lg">Pronto publicaremos nuestros productos.</p>
      ) : (
        <>
          <nav aria-label="Categorías" className="mb-8">
            <ul className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <li key={c.slug}>
                  <a
                    href={`#${c.slug}`}
                    className="block rounded-full bg-accent-soft px-4 py-2 font-semibold text-accent-soft-foreground hover:opacity-90"
                  >
                    {c.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          {categories.map((c) => (
            <section
              key={c.slug}
              id={c.slug}
              aria-labelledby={`${c.slug}-titulo`}
              className="mb-12 scroll-mt-24"
            >
              <h2 id={`${c.slug}-titulo`} className="mb-4 text-2xl font-bold">
                {c.name}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {c.products.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  );
}
