import { parseCOPInput } from '@panesypan/shared';
import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/form';
import { cn } from '@/lib/utils';

interface PriceInputProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> {
  value: number | null;
  onValueChange: (value: number | null) => void;
}

const thousands = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 0,
  useGrouping: 'always',
});

/**
 * Campo de precio en pesos: muestra "12.500" mientras se escribe y entrega el número entero.
 * Abre el teclado numérico en celulares y tablets.
 */
export function PriceInput({ value, onValueChange, className, ...props }: PriceInputProps) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-bold text-muted-foreground"
      >
        $
      </span>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value === null ? '' : thousands.format(value)}
        onChange={(event) => {
          onValueChange(parseCOPInput(event.target.value));
        }}
        className={cn('pl-8 font-bold', className)}
        {...props}
      />
    </div>
  );
}
