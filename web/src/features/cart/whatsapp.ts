import { formatCOP, type CreateWebOrderResponse, type WebOrderCustomer } from '@panesypan/shared';

/** Mensaje de WhatsApp con el número y los totales que devolvió la API. */
export function buildOrderMessage(
  order: CreateWebOrderResponse['order'],
  customer: WebOrderCustomer,
): string {
  const lines = order.lines.map(
    (line) => `- ${String(line.quantity)} x ${line.name}: ${formatCOP(line.total)}`,
  );
  return [
    `Hola, acabo de hacer el pedido web #${String(order.number)}:`,
    ...lines,
    `Subtotal: ${formatCOP(order.subtotal)}`,
    'Domicilio: a confirmar por WhatsApp',
    `Nombre: ${customer.name}`,
    `Dirección: ${customer.address}`,
    `Barrio: ${customer.neighborhood}`,
    ...(customer.note ? [`Nota: ${customer.note}`] : []),
  ].join('\n');
}

/** Enlace wa.me, o null si el negocio aún no tiene WhatsApp configurado. */
export function whatsappUrl(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits === '') return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
