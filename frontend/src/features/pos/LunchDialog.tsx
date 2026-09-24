import type { DailyMenu } from '@panesypan/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { PosProduct } from './use-pos-catalog';

/** Qué trae el almuerzo de hoy, para leérselo al cliente. */
function menuSummary(menu: DailyMenu): string {
  return [
    menu.soup === '' ? null : `Sopa: ${menu.soup}`,
    menu.principle === '' ? null : `Principio: ${menu.principle}`,
    menu.sides.length === 0 ? null : menu.sides.join(', '),
    menu.juice === '' ? null : `Jugo: ${menu.juice}`,
  ]
    .filter((part) => part !== null)
    .join(' · ');
}

/** Al vender un almuerzo, la cajera elige la proteína: queda como nota en la cuenta y el tiquete. */
export function LunchDialog({
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
        <DialogContent title={`${product.name}: ¿qué proteína?`} description={menuSummary(menu)}>
          <div className="grid gap-2 sm:grid-cols-2">
            {menu.proteins.map((protein) => (
              <Button
                key={protein.name}
                variant="outline"
                size="lg"
                className="h-14 text-base"
                disabled={!protein.isAvailable}
                onClick={() => {
                  onChoose(product, protein.name);
                }}
              >
                {protein.name}
                {protein.isAvailable ? null : ' (agotada)'}
              </Button>
            ))}
          </div>
          {menu.notes === '' ? null : (
            <p className="mt-3 text-sm text-muted-foreground">{menu.notes}</p>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}
