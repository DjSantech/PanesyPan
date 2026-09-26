import { ContactDetails } from '@/components/ContactDetails';
import { PageHeading } from '@/components/PageHeading';
import { getContactInfo } from '@/lib/business';
import { pageMetadata } from '@/lib/seo/site';

export const metadata = pageMetadata({
  title: 'Nosotros',
  description:
    'Conoce Panes & Panes, panadería de barrio en Dosquebradas, Risaralda: quiénes somos, horarios y cómo llegar.',
  path: '/nosotros',
});

export default async function AboutPage() {
  const contact = await getContactInfo();
  return (
    <>
      <PageHeading title="Nosotros">
        Somos {contact.name}, una panadería de barrio en {contact.city}.
      </PageHeading>
      <div className="grid gap-10 md:grid-cols-2">
        <section aria-labelledby="historia" className="space-y-4 text-lg">
          <h2 id="historia" className="text-2xl font-bold">
            Hecho en casa
          </h2>
          <p>
            Horneamos cada día para nuestros vecinos: pan, productos de panadería y almuerzo casero.
          </p>
        </section>
        <section aria-labelledby="ubicacion">
          <h2 id="ubicacion" className="mb-4 text-2xl font-bold">
            Dónde estamos
          </h2>
          <ContactDetails contact={contact} />
        </section>
      </div>
    </>
  );
}
