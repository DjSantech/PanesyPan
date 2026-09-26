import { PageHeading } from '@/components/PageHeading';
import { Checkout } from '@/features/cart/Checkout';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tu pedido',
  robots: { index: false },
};

export default function PedidoPage() {
  return (
    <>
      <PageHeading title="Tu pedido">
        Domicilios en Dosquebradas. El costo del domicilio se confirma por WhatsApp.
      </PageHeading>
      <Checkout />
    </>
  );
}
