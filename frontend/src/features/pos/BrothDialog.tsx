import { formatCOP, type DailyMenu } from '@panesypan/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ChoiceGroup, NoteField } from './LunchDialog';
import { onlyOption } from './lunch-menu-helpers';
import type { PosProduct } from './use-pos-catalog';

function BrothForm({
  product,
  menu,
  onChoose,
}: {
  product: PosProduct;
  menu: DailyMenu;
  onChoose: (product: PosProduct, note: string) => void;
}) {
  const [soup, setSoup] = useState<string | null>(() => onlyOption(menu.soups));
  const [note, setNote] = useState('');

  return (
    <div className="grid gap-5">
      <ChoiceGroup title="¿Cuál caldo?" options={menu.soups} value={soup} onChange={setSoup} />
      <NoteField id="broth-note" value={note} onChange={setNote} />
      <Button
        size="lg"
        className="h-14 text-base"
        disabled={soup === null}
        onClick={() => {
          if (soup === null) return;
          onChoose(product, [soup, note.trim()].filter(Boolean).join(' · '));
        }}
      >
        {soup === null ? 'Elige cuál caldo' : `Agregar ${soup} · ${formatCOP(product.price)}`}
      </Button>
    </div>
  );
}

/**
 * Al vender un caldo (sin elección de proteína/principio), la cajera elige cuál de los que hay
 * en el menú de hoy. Si no hay ninguna sopa configurada, no tiene sentido mostrar el diálogo:
 * el llamador lo evita directamente (ver `pickProduct` en PosPage).
 */
export function BrothDialog({
  product,
  menu,
  onOpenChange,
  onChoose,
}: {
  product: PosProduct | null;
  menu: DailyMenu;
  onOpenChange: (open: boolean) => void;
  onChoose: (product: PosProduct, note: string) => void;
}) {
  return (
    <Dialog open={product !== null} onOpenChange={onOpenChange}>
      {product === null ? null : (
        <DialogContent
          title={product.name}
          description="Elige cuál de los caldos de hoy es."
          className="sm:max-w-xl"
        >
          <BrothForm key={product.id} product={product} menu={menu} onChoose={onChoose} />
        </DialogContent>
      )}
    </Dialog>
  );
}
