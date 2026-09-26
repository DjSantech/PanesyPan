import { negocio } from '@/config/negocio';
import { getBusiness } from './api';

export interface ContactInfo {
  name: string;
  address: string;
  city: string;
  phone: string;
  whatsappUrl: string | null;
  phoneUrl: string | null;
  mapUrl: string | null;
  mapEmbedUrl: string | null;
}

/** Datos de contacto: negocio.ts primero; dirección y teléfono con respaldo de la API. */
export async function getContactInfo(): Promise<ContactInfo> {
  const api = await getBusiness();
  const address = negocio.address || api.address;
  const phone = negocio.phone || api.phone;
  const digits = phone.replace(/\D/g, '');
  const coords = negocio.coordinates;
  const coordText = coords ? `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}` : null;
  return {
    name: negocio.name,
    address,
    city: negocio.city,
    phone,
    whatsappUrl: negocio.whatsapp ? `https://wa.me/${negocio.whatsapp}` : null,
    phoneUrl: digits ? `tel:${digits}` : null,
    mapUrl: coordText ? `https://www.google.com/maps/search/?api=1&query=${coordText}` : null,
    mapEmbedUrl: coordText ? `https://www.google.com/maps?q=${coordText}&output=embed` : null,
  };
}
