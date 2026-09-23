import { AUTH_POLICY } from '@panesypan/shared';
import { Delete } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  /** Se llama cuando se completan los 6 dígitos. */
  onComplete?: (pin: string) => void;
  disabled?: boolean;
  label: string;
  error?: string | null;
  autoFocus?: boolean;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'] as const;

/**
 * Teclado numérico grande para la tablet. También funciona con el teclado físico
 * (números, Retroceso). Los dígitos nunca se muestran: solo puntos.
 */
export function PinPad({
  value,
  onChange,
  onComplete,
  disabled = false,
  label,
  error,
  autoFocus = true,
}: PinPadProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const length = AUTH_POLICY.pinLength;

  useEffect(() => {
    if (autoFocus) containerRef.current?.focus();
  }, [autoFocus]);

  const press = (key: (typeof KEYS)[number]) => {
    if (disabled) return;
    if (key === 'back') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === '' || value.length >= length) return;
    const next = value + key;
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      press(event.key as (typeof KEYS)[number]);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      press('back');
    }
  };

  const hasError = error !== null && error !== undefined && error.length > 0;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="group"
      aria-label={label}
      className="grid w-full max-w-xs justify-items-center gap-5 rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <div className="flex gap-3" aria-hidden="true">
        {Array.from({ length }, (_, index) => (
          <span
            key={index}
            className={cn(
              'size-4 rounded-full border-2 transition-colors',
              index < value.length ? 'border-primary bg-primary' : 'border-input bg-transparent',
              hasError && 'border-danger',
              hasError && index < value.length && 'bg-danger',
            )}
          />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {`${String(value.length)} de ${String(length)} dígitos`}
      </p>
      <p
        role={hasError ? 'alert' : undefined}
        className={cn(
          'min-h-5 text-center text-sm font-bold',
          hasError ? 'text-danger' : 'text-transparent',
        )}
      >
        {hasError ? error : '·'}
      </p>
      <div className="grid w-full grid-cols-3 gap-3">
        {KEYS.map((key, index) =>
          key === '' ? (
            <span key={`empty-${String(index)}`} />
          ) : (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => {
                press(key);
              }}
              aria-label={key === 'back' ? 'Borrar último dígito' : `Dígito ${key}`}
              className={cn(
                'grid h-16 place-items-center rounded-2xl text-2xl font-extrabold transition-colors select-none disabled:opacity-50',
                'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                key === 'back'
                  ? 'text-muted-foreground hover:bg-muted active:bg-muted'
                  : 'border border-border bg-card shadow-xs hover:bg-muted active:bg-muted',
              )}
            >
              {key === 'back' ? <Delete className="size-7" aria-hidden="true" /> : key}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
