import { ContactDetails } from '@/components/ContactDetails';
import { PageHeading } from '@/components/PageHeading';
import { getContactInfo } from '@/lib/business';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Contacto',
  description: 'Escríbenos o visítanos en Dosquebradas, Risaralda.',
};

export default async function ContactPage() {
  const contact = await getContactInfo();
  return (
    <>
      <PageHeading title="Contacto">Con gusto te atendemos.</PageHeading>
      <ContactDetails contact={contact} />
    </>
  );
}
