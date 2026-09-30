import { formatCOP, type DailyMenu, type LunchChoice, type MenuOption } from '@panesypan/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { initialChoice, NO_CHOICE, onlyOption } from './lunch-menu-helpers';
import type { PosProduct } from './use-pos-catalog';

/** Grupo de botones grandes para elegir una opción del menú (una sola a la vez). */
export function ChoiceGroup({
  title,
  options,
  value,
  onChange,
  extra,
}: {
  title: string;
  options: MenuOption[];
  value: string | null;
  onChange: (value: string) => void;
  /** Opción adicional al final (p. ej. "Sin sopa"). */
  extra?: { value: string; label: string };
}) {
  const available = options.filter((option) => option.isAvailable);
  const items = [
    ...available.map((option) => ({ value: option.name, label: option.name })),
    ...(extra === undefined ? [] : [extra]),
  ];
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-bold">{title}</legend>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay opciones disponibles hoy.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={title}>
          {items.map((item) => {
            const selected = value === item.value;
            return (
              <Button
                key={item.value === NO_CHOICE ? '__sin__' : item.value}
                role="radio"
                aria-checked={selected}
                variant={selected ? 'default' : 'outline'}
                size="lg"
                className={cn('h-12 text-base', selected && 'ring-3 ring-ring/40')}
                onClick={() => {
                  onChange(item.value);
                }}
              >
                {item.label}
              </Button>
            );
          })}
        </div>
      )}
      {options.some((option) => !option.isAvailable) ? (
        <p className="text-xs text-muted-foreground">
          Agotado:{' '}
          {options
            .filter((option) => !option.isAvailable)
            .map((option) => option.name)
            .join(', ')}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Nota libre para la cocina (p. ej. "sin arroz", "bien picante"). */
export function NoteField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label="Nota para la cocina (opcional)">
      <Textarea
        id={id}
        rows={2}
        placeholder="Ej.: Sin arroz, bien picante…"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}

function LunchForm({
  product,
  menu,
  onChoose,
}: {
  product: PosProduct;
  menu: DailyMenu;
  onChoose: (product: PosProduct, lunch: LunchChoice, note: string) => void;
}) {
  const [protein, setProtein] = useState(() => onlyOption(menu.proteins));
  const [principle, setPrinciple] = useState(() => onlyOption(menu.principles));
  const [soup, setSoup] = useState<string | null>(() => initialChoice(menu.soups));
  const [drink, setDrink] = useState<string | null>(() => initialChoice(menu.drinks));
  const [note, setNote] = useState('');

  const ready = protein !== null && principle !== null && soup !== null && drink !== null;

  return (
    <div className="grid gap-5">
      <ChoiceGroup
        title="1. Proteína"
        options={menu.proteins}
        value={protein}
        onChange={setProtein}
      />
      <ChoiceGroup
        title="2. Principio"
        options={menu.principles}
        value={principle}
        onChange={setPrinciple}
      />
      <ChoiceGroup
        title="3. Sopa (va incluida)"
        options={menu.soups}
        value={soup}
        onChange={setSoup}
        extra={{ value: NO_CHOICE, label: 'Sin sopa' }}
      />
      <ChoiceGroup
        title="4. Bebida (va incluida)"
        options={menu.drinks}
        value={drink}
        onChange={setDrink}
        extra={{ value: NO_CHOICE, label: 'Sin bebida' }}
      />
      {menu.notes === '' ? null : <p className="text-sm text-muted-foreground">{menu.notes}</p>}
      <NoteField id="lunch-note" value={note} onChange={setNote} />
      <Button
        size="lg"
        className="h-14 text-base"
        disabled={!ready}
        onClick={() => {
          if (protein === null || principle === null || soup === null || drink === null) return;
          onChoose(
            product,
            {
              protein,
              principle,
              soup: soup === NO_CHOICE ? null : soup,
              drink: drink === NO_CHOICE ? null : drink,
            },
            note.trim(),
          );
        }}
      >
        {ready
          ? `Agregar almuerzo · ${formatCOP(product.price)}`
          : 'Elige proteína, principio, sopa y bebida'}
      </Button>
    </div>
  );
}

/** Al vender un almuerzo, la cajera elige proteína, principio, sopa y bebida (se pueden quitar). */
export function LunchDialog({
  product,
  menu,
  onOpenChange,
  onChoose,
}: {
  product: PosProduct | null;
  menu: DailyMenu;
  onOpenChange: (open: boolean) => void;
  onChoose: (product: PosProduct, lunch: LunchChoice, note: string) => void;
}) {
  return (
    <Dialog open={product !== null} onOpenChange={onOpenChange}>
      {product === null ? null : (
        <DialogContent
          title={product.name}
          description="Pregúntale al cliente la proteína, el principio, la sopa y la bebida."
          className="sm:max-w-xl"
        >
          <LunchForm key={product.id} product={product} menu={menu} onChoose={onChoose} />
        </DialogContent>
      )}
    </Dialog>
  );
}
