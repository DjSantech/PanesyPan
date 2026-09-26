import { ContactDetails } from '@/components/ContactDetails';
import { PageHeading } from '@/components/PageHeading';
import { getContactInfo } from '@/lib/business';
import { pageMetadata } from '@/lib/seo/site';

export const metadata = pageMetadata({
  title: 'Contacto',
  description:
    'Escríbenos por WhatsApp o visita nuestra panadería en Dosquebradas, Risaralda: ubicación y datos de contacto.',
  path: '/contacto',
});

export default async function ContactPage() {
  const contact = await getContactInfo();
  return (
    <>
      <PageHeading title="Contacto">Con gusto te atendemos.</PageHeading>
      <ContactDetails contact={contact} />
    </>
  );
}
