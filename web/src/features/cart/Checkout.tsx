'use client';

import { negocio } from '@/config/negocio';
import { getApiUrl } from '@/lib/api';
import {
  apiErrorResponseSchema,
  createWebOrderRequestSchema,
  createWebOrderResponseSchema,
  DELIVERY_NEIGHBORHOODS,
  formatCOP,
  lunchChoiceLabel,
  WEB_ORDER_LIMITS,
  type CreateWebOrderResponse,
} from '@panesypan/shared';
import { Minus, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState, type SyntheticEvent } from 'react';
import { cartSubtotal, clearCart, lineKey, setQuantity, useCart } from './cart-store';
import { buildOrderMessage, whatsappUrl } from './whatsapp';

type Field = 'name' | 'phone' | 'address' | 'neighborhood' | 'note' | 'confirmsDosquebradas';
type Errors = Partial<Record<Field | 'form', string>>;

interface Done {
  order: CreateWebOrderResponse['order'];
  link: string | null;
}

const inputClass =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-ring';

export function Checkout() {
  const items = useCart();
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    neighborhood: '',
    note: '',
    confirmsDosquebradas: false,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  // Un solo id por intento de compra: si se reintenta el envío, la API no duplica el pedido.
  const requestId = useRef<string | null>(null);
  const hasZones = DELIVERY_NEIGHBORHOODS.length > 0;

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  async function submit(event: SyntheticEvent) {
    event.preventDefault();
    const api = getApiUrl();
    if (!api) {
      setErrors({ form: 'Los pedidos en línea aún no están disponibles. Escríbenos o llámanos.' });
      return;
    }
    requestId.current ??= crypto.randomUUID();
    const { confirmsDosquebradas, ...customer } = form;
    const parsed = createWebOrderRequestSchema.safeParse({
      clientRequestId: requestId.current,
      customer,
      confirmsDosquebradas,
      lines: items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        lunch: item.lunch,
      })),
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = (issue.path.at(-1) ?? 'form') as Field | 'form';
        const field = key in form ? key : 'form';
        next[field] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    if (!hasZones && !confirmsDosquebradas) {
      setErrors({ confirmsDosquebradas: 'Solo hacemos domicilios en Dosquebradas' });
      return;
    }
    if (hasZones && !DELIVERY_NEIGHBORHOODS.includes(parsed.data.customer.neighborhood)) {
      setErrors({ neighborhood: 'Solo hacemos domicilios en Dosquebradas' });
      return;
    }

    setErrors({});
    setSending(true);
    try {
      const res = await fetch(`${api}/api/v1/public/pedidos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const error = apiErrorResponseSchema.safeParse(body);
        setErrors({
          form: error.success
            ? error.data.error.message
            : 'No pudimos enviar tu pedido. Intenta de nuevo.',
        });
        return;
      }
      const { order } = createWebOrderResponseSchema.parse(body);
      const link = whatsappUrl(negocio.whatsapp, buildOrderMessage(order, parsed.data.customer));
      clearCart();
      requestId.current = null;
      setDone({ order, link });
      if (link !== null) window.open(link, '_blank', 'noopener,noreferrer');
    } catch {
      setErrors({ form: 'No pudimos conectarnos. Revisa tu internet e intenta de nuevo.' });
    } finally {
      setSending(false);
    }
  }

  if (done !== null) {
    return (
      <section className="rounded-xl border bg-card p-6 shadow-sm" aria-live="polite">
        <h2 className="text-2xl font-bold">¡Pedido #{done.order.number} recibido!</h2>
        <p className="mt-2 text-lg">Total de productos: {formatCOP(done.order.subtotal)}</p>
        <p className="text-muted-foreground">
          Domicilio: lo cotiza el domiciliario (solo Dosquebradas)
        </p>
        {done.link !== null ? (
          <a
            href={done.link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-success px-5 py-2 font-semibold text-white"
          >
            Enviar el pedido por WhatsApp
          </a>
        ) : (
          <p className="mt-4 text-lg">Te contactaremos al teléfono que dejaste.</p>
        )}
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <p className="text-lg">Tu pedido está vacío.</p>
        <Link href="/menu" className="mt-3 inline-block font-semibold text-primary underline">
          Ver el menú
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section aria-labelledby="resumen-titulo">
        <h2 id="resumen-titulo" className="mb-4 text-2xl font-bold">
          Tu pedido
        </h2>
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((item) => (
            <li key={lineKey(item)} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{item.name}</p>
                {item.lunch !== null && <p className="text-sm">{lunchChoiceLabel(item.lunch)}</p>}
                <p className="text-sm text-muted-foreground">{formatCOP(item.price)} c/u</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-full p-2 hover:bg-muted"
                  aria-label={`Quitar uno de ${item.name}`}
                  onClick={() => setQuantity(lineKey(item), item.quantity - 1)}
                >
                  <Minus aria-hidden className="size-4" />
                </button>
                <span className="w-8 text-center font-bold">{item.quantity}</span>
                <button
                  type="button"
                  className="rounded-full p-2 hover:bg-muted disabled:opacity-40"
                  aria-label={`Agregar uno de ${item.name}`}
                  disabled={item.quantity >= WEB_ORDER_LIMITS.quantityMax}
                  onClick={() => setQuantity(lineKey(item), item.quantity + 1)}
                >
                  <Plus aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  className="rounded-full p-2 text-danger hover:bg-danger-soft"
                  aria-label={`Quitar ${item.name} del pedido`}
                  onClick={() => setQuantity(lineKey(item), 0)}
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </div>
              <p className="w-24 text-right font-bold">{formatCOP(item.price * item.quantity)}</p>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 text-lg">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd className="font-bold">{formatCOP(cartSubtotal(items))}</dd>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <dt>Domicilio</dt>
            <dd>lo cotiza el domiciliario</dd>
          </div>
        </dl>
        <p className="mt-2 text-sm text-muted-foreground">
          Los precios finales los confirma el sistema al enviar el pedido.
        </p>
      </section>

      <form onSubmit={(e) => void submit(e)} noValidate aria-labelledby="datos-titulo">
        <h2 id="datos-titulo" className="mb-4 text-2xl font-bold">
          Datos de entrega
        </h2>
        <div className="space-y-4">
          <TextField
            id="name"
            label="Nombre"
            value={form.name}
            error={errors.name}
            autoComplete="name"
            maxLength={WEB_ORDER_LIMITS.nameMax}
            onChange={(v) => set('name', v)}
          />
          <TextField
            id="phone"
            label="Celular"
            value={form.phone}
            error={errors.phone}
            autoComplete="tel-national"
            inputMode="numeric"
            maxLength={10}
            onChange={(v) => set('phone', v.replace(/\D/g, ''))}
          />
          <TextField
            id="address"
            label="Dirección"
            value={form.address}
            error={errors.address}
            autoComplete="street-address"
            maxLength={WEB_ORDER_LIMITS.addressMax}
            onChange={(v) => set('address', v)}
          />
          {hasZones ? (
            <div>
              <label htmlFor="neighborhood" className="mb-1 block font-semibold">
                Barrio
              </label>
              <select
                id="neighborhood"
                className={inputClass}
                value={form.neighborhood}
                aria-invalid={errors.neighborhood ? true : undefined}
                aria-describedby={errors.neighborhood ? 'neighborhood-error' : undefined}
                onChange={(e) => set('neighborhood', e.target.value)}
              >
                <option value="">Elige tu barrio</option>
                {DELIVERY_NEIGHBORHOODS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              {errors.neighborhood && (
                <p id="neighborhood-error" className="mt-1 text-sm text-danger">
                  {errors.neighborhood}
                </p>
              )}
            </div>
          ) : (
            <>
              <TextField
                id="neighborhood"
                label="Barrio"
                value={form.neighborhood}
                error={errors.neighborhood}
                maxLength={WEB_ORDER_LIMITS.neighborhoodMax}
                onChange={(v) => set('neighborhood', v)}
              />
              <div>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1 size-5"
                    checked={form.confirmsDosquebradas}
                    aria-invalid={errors.confirmsDosquebradas ? true : undefined}
                    aria-describedby={
                      errors.confirmsDosquebradas ? 'confirmsDosquebradas-error' : undefined
                    }
                    onChange={(e) => set('confirmsDosquebradas', e.target.checked)}
                  />
                  <span className="font-semibold">Mi dirección está en Dosquebradas</span>
                </label>
                {errors.confirmsDosquebradas && (
                  <p id="confirmsDosquebradas-error" className="mt-1 text-sm text-danger">
                    {errors.confirmsDosquebradas}
                  </p>
                )}
              </div>
            </>
          )}
          <div>
            <label htmlFor="note" className="mb-1 block font-semibold">
              Nota (opcional)
            </label>
            <textarea
              id="note"
              className={inputClass}
              rows={3}
              maxLength={WEB_ORDER_LIMITS.noteMax}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
            />
            {errors.note && <p className="mt-1 text-sm text-danger">{errors.note}</p>}
          </div>
          {errors.form && (
            <p role="alert" className="rounded-md bg-danger-soft p-3 font-semibold text-danger">
              {errors.form}
            </p>
          )}
          <button
            type="submit"
            disabled={sending}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-primary px-6 py-3 text-lg font-bold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {sending ? 'Enviando…' : 'Hacer pedido'}
          </button>
        </div>
      </form>
    </div>
  );
}

function TextField(props: {
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  maxLength: number;
  autoComplete?: string;
  inputMode?: 'numeric' | 'text';
  onChange: (value: string) => void;
}) {
  const errorId = `${props.id}-error`;
  return (
    <div>
      <label htmlFor={props.id} className="mb-1 block font-semibold">
        {props.label}
      </label>
      <input
        id={props.id}
        className={inputClass}
        value={props.value}
        maxLength={props.maxLength}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? errorId : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.error && (
        <p id={errorId} className="mt-1 text-sm text-danger">
          {props.error}
        </p>
      )}
    </div>
  );
}
