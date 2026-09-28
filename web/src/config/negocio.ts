import { BUSINESS_NAME } from '@panesypan/shared';

/*
 * ÚNICO lugar con los datos del negocio para la web pública.
 * Un dato vacío ('' / null / []) no se muestra. Nunca se inventan datos.
 */

export interface OpeningHours {
  /** Ej.: "Lunes a sábado". */
  days: string;
  /** Ej.: "6:00 a. m. – 8:00 p. m.". */
  hours: string;
}

export interface Negocio {
  name: string;
  /** Dirección completa. Si está vacía, se usa la de Ajustes (API /negocio). */
  address: string;
  city: string;
  openingHours: OpeningHours[];
  /** WhatsApp en formato internacional sin "+" ni espacios (ej. 57XXXXXXXXXX). */
  whatsapp: string;
  /** Teléfono. Si está vacío, se usa el de Ajustes (API /negocio). */
  phone: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  coordinates: { lat: number; lng: number } | null;
  /** Costo de domicilio en COP; null = "a confirmar por WhatsApp". */
  deliveryFee: number | null;
}

export const negocio: Negocio = {
  name: BUSINESS_NAME,
  // TODO(dueño): dirección exacta del local.
  address: '',
  city: 'Dosquebradas, Risaralda',
  // TODO(dueño): días y horario de atención.
  openingHours: [],
  // TODO(dueño): número de WhatsApp del negocio.
  whatsapp: '',
  // TODO(dueño): teléfono fijo o celular del negocio.
  phone: '',
  instagram: 'https://www.instagram.com/panesypan',
  facebook: 'https://www.facebook.com/profile.php?id=61594512882670',
  tiktok: 'https://www.tiktok.com/@panesypan',
  // TODO(dueño): coordenadas del local para el mapa.
  coordinates: null,
  // TODO(dueño): costo fijo del domicilio, si lo hay.
  deliveryFee: null,
};
