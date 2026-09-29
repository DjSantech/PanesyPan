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
  /** Mismo horario en formato schema.org para Google (ej. "Mo-Sa 06:00-20:00"). */
  schema: string;
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
  address: 'Avenida Simón Bolívar, Calle 33 # 14-85, Guadalupe',
  city: 'Dosquebradas, Risaralda',
  openingHours: [
    { days: 'Lunes a sábado', hours: '6:00 a. m. – 9:00 p. m.', schema: 'Mo-Sa 06:00-21:00' },
    { days: 'Domingo', hours: '7:00 a. m. – 5:00 p. m.', schema: 'Su 07:00-17:00' },
  ],
  whatsapp: '573122447518',
  // TODO(dueño): teléfono fijo o celular del negocio.
  phone: '',
  instagram: 'https://www.instagram.com/panesypan',
  facebook: 'https://www.facebook.com/profile.php?id=61594512882670',
  tiktok: 'https://www.tiktok.com/@panesypan',
  // TODO(dueño): coordenadas del local (opcional: sin ellas el mapa busca la dirección).
  coordinates: null,
  // TODO(dueño): costo fijo del domicilio, si lo hay.
  deliveryFee: null,
};
