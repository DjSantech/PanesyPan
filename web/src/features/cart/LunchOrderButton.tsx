'use client';

import type { DailyMenuOption } from '@/lib/types';
import { formatCOP, type LunchChoice } from '@panesypan/shared';
import { Plus, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { addToCart } from './cart-store';

const NO_SOUP = '';

export interface LunchOptions {
  soups: DailyMenuOption[];
  principles: DailyMenuOption[];
  proteins: DailyMenuOption[];
}

/** Si solo hay una opción disponible, queda elegida. */
function onlyOption(options: DailyMenuOption[]): string | null {
  const available = options.filter((o) => o.isAvailable);
  return available.length === 1 ? (available[0]?.name ?? null) : null;
}

function initialSoup(soups: DailyMenuOption[]): string | null {
  return soups.some((o) => o.isAvailable) ? onlyOption(soups) : NO_SOUP;
}

function ChoiceGroup({
  title,
  name,
  options,
  value,
  onChange,
  withNoSoup = false,
}: {
  title: string;
  name: string;
  options: DailyMenuOption[];
  value: string | null;
  onChange: (value: string) => void;
  withNoSoup?: boolean;
}) {
  const choices = [
    ...options.filter((o) => o.isAvailable).map((o) => ({ value: o.name, label: o.name })),
    ...(withNoSoup ? [{ value: NO_SOUP, label: 'Sin sopa' }] : []),
  ];
  const soldOut = options.filter((o) => !o.isAvailable);
  return (
    <fieldset>
      <legend className="mb-2 font-bold">{title}</legend>
      {choices.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay opciones disponibles hoy.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {choices.map((c) => (
            <label
              key={c.value === NO_SOUP ? '__sin__' : c.value}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 has-checked:border-primary has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-ring"
            >
              <input
                type="radio"
                name={name}
                className="size-4 accent-primary"
                checked={value === c.value}
                onChange={() => onChange(c.value)}
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )}
      {soldOut.length > 0 && (
        <ul className="mt-2 text-sm text-muted-foreground">
          {soldOut.map((o) => (
            <li key={o.name}>
              <s>{o.name}</s> <span className="font-semibold text-danger">Agotado</span>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

const buttonClass =
  'inline-flex min-h-11 items-center gap-1 rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60';

/** Botón "Pedir almuerzo": abre un diálogo para elegir proteína, principio y sopa. */
export function LunchOrderButton({
  product,
  options,
}: {
  product: { id: string; name: string; price: number };
  options: LunchOptions;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [protein, setProtein] = useState<string | null>(null);
  const [principle, setPrinciple] = useState<string | null>(null);
  const [soup, setSoup] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const ready = protein !== null && principle !== null && soup !== null;

  function open() {
    setProtein(onlyOption(options.proteins));
    setPrinciple(onlyOption(options.principles));
    setSoup(initialSoup(options.soups));
    dialogRef.current?.showModal();
  }

  function confirm() {
    if (protein === null || principle === null || soup === null) return;
    const lunch: LunchChoice = { protein, principle, soup: soup === NO_SOUP ? null : soup };
    addToCart(product, lunch);
    dialogRef.current?.close();
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1200);
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={buttonClass}
        aria-haspopup="dialog"
        aria-label={`Pedir almuerzo: ${product.name}`}
      >
        <Plus aria-hidden className="size-4" />
        <span aria-live="polite">{added ? 'Agregado' : 'Pedir almuerzo'}</span>
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-card-foreground shadow-lg backdrop:bg-black/50"
      >
        <div className="space-y-5 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-xl font-bold">
              {product.name}
            </h2>
            <button
              type="button"
              className="rounded-full p-2 hover:bg-muted"
              aria-label="Cerrar"
              onClick={() => dialogRef.current?.close()}
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <ChoiceGroup
            title="1. Proteína"
            name={`${titleId}-proteina`}
            options={options.proteins}
            value={protein}
            onChange={setProtein}
          />
          <ChoiceGroup
            title="2. Principio"
            name={`${titleId}-principio`}
            options={options.principles}
            value={principle}
            onChange={setPrinciple}
          />
          <ChoiceGroup
            title="3. Sopa"
            name={`${titleId}-sopa`}
            options={options.soups}
            value={soup}
            onChange={setSoup}
            withNoSoup
          />
          <button
            type="button"
            className={`${buttonClass} w-full justify-center`}
            disabled={!ready}
            onClick={confirm}
          >
            {ready
              ? `Agregar almuerzo · ${formatCOP(product.price)}`
              : 'Elige proteína, principio y sopa'}
          </button>
        </div>
      </dialog>
    </>
  );
}
