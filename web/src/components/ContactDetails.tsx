import { negocio } from '@/config/negocio';
import type { ContactInfo } from '@/lib/business';
import { Clock, MapPin, MessageCircle, Phone } from 'lucide-react';

/** Muestra solo los datos que existen; si falta alguno, no se muestra. */
export function ContactDetails({ contact }: { contact: ContactInfo }) {
  const hasHours = negocio.openingHours.length > 0;
  return (
    <div className="space-y-6">
      <dl className="space-y-4">
        <div className="flex gap-3">
          <MapPin aria-hidden className="mt-1 size-5 shrink-0 text-primary" />
          <div>
            <dt className="font-bold">Ubicación</dt>
            <dd>
              {contact.address && <span className="block">{contact.address}</span>}
              {contact.city}
            </dd>
          </div>
        </div>
        {hasHours && (
          <div className="flex gap-3">
            <Clock aria-hidden className="mt-1 size-5 shrink-0 text-primary" />
            <div>
              <dt className="font-bold">Horario</dt>
              {negocio.openingHours.map((h) => (
                <dd key={h.days}>
                  {h.days}: {h.hours}
                </dd>
              ))}
            </div>
          </div>
        )}
        {contact.phoneUrl && (
          <div className="flex gap-3">
            <Phone aria-hidden className="mt-1 size-5 shrink-0 text-primary" />
            <div>
              <dt className="font-bold">Teléfono</dt>
              <dd>
                <a href={contact.phoneUrl} className="underline underline-offset-4">
                  {contact.phone}
                </a>
              </dd>
            </div>
          </div>
        )}
      </dl>
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
      {contact.mapEmbedUrl && contact.mapUrl && (
        <div>
          <iframe
            title={`Mapa de ubicación de ${contact.name}`}
            src={contact.mapEmbedUrl}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="aspect-video w-full rounded-xl border"
          />
          <a
            href={contact.mapUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block font-semibold text-primary hover:underline"
          >
            Abrir en Google Maps
          </a>
        </div>
      )}
    </div>
  );
}
