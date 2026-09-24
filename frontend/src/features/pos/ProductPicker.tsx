import { formatCOP, slugify, type Category } from '@panesypan/shared';
import { productImageUrl } from '../catalog/catalog.api';
import { Search, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/components/feedback';
import { Input } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import type { PosProduct } from './use-pos-catalog';

const FAVORITES = 'favoritos';
const ALL = 'todos';

interface ProductPickerProps {
  categories: Category[];
  products: PosProduct[];
  onPick: (product: PosProduct) => void;
  disabled?: boolean;
}

/**
 * Cuadrícula de productos para la pantalla táctil: botones grandes, búsqueda sin tildes
 * (tecla "/" para buscar) y filtro por categoría con los favoritos primero.
 */
export function ProductPicker({
  categories,
  products,
  onPick,
  disabled = false,
}: ProductPickerProps) {
  const hasFavorites = products.some((product) => product.isFavorite);
  const [filter, setFilter] = useState<string>(hasFavorites ? FAVORITES : ALL);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const visible = useMemo(() => {
    const term = slugify(search);
    const sorted = [...products].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'),
    );
    if (term !== '') return sorted.filter((product) => slugify(product.name).includes(term));
    if (filter === FAVORITES) return sorted.filter((product) => product.isFavorite);
    if (filter === ALL) return sorted;
    return sorted.filter((product) => product.categoryId === filter);
  }, [products, filter, search]);

  const chips = [
    ...(hasFavorites ? [{ id: FAVORITES, name: 'Favoritos' }] : []),
    { id: ALL, name: 'Todos' },
    ...categories.map((category) => ({ id: category.id, name: category.name })),
  ];

  return (
    <div className="grid gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={searchRef}
          type="search"
          aria-label="Buscar producto"
          placeholder="Buscar producto  ( / )"
          className="pl-11"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSearch('');
            // Enter agrega el primer resultado: rápido con lector de código o teclado.
            const first = visible[0];
            if (event.key === 'Enter' && first?.isAvailable === true) {
              event.preventDefault();
              onPick(first);
              setSearch('');
            }
          }}
        />
      </div>

      <div
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        role="radiogroup"
        aria-label="Categoría"
      >
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            role="radio"
            aria-checked={search === '' && filter === chip.id}
            onClick={() => {
              setFilter(chip.id);
              setSearch('');
            }}
            className={cn(
              'flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-bold whitespace-nowrap focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
              search === '' && filter === chip.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {chip.id === FAVORITES ? <Star className="size-4" aria-hidden="true" /> : null}
            {chip.name}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={search === '' ? 'No hay productos aquí' : `Sin resultados para "${search}"`}
          description={search === '' ? 'Elige otra categoría.' : 'Revisa cómo lo escribiste.'}
        />
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4" aria-label="Productos">
          {visible.map((product) => {
            const soldOut = !product.isAvailable || product.portionsLeft === 0;
            return (
              <li key={product.id}>
                <button
                  type="button"
                  disabled={disabled || soldOut}
                  onClick={() => {
                    onPick(product);
                  }}
                  aria-label={`${product.name}, ${formatCOP(product.price)}${soldOut ? ', agotado' : ''}`}
                  className={cn(
                    'flex h-full min-h-24 w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left shadow-xs transition-colors',
                    'hover:border-primary/50 active:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                    'disabled:cursor-not-allowed disabled:opacity-55',
                  )}
                >
                  {product.imagePath === null ? null : (
                    <img
                      src={productImageUrl(product.imagePath) ?? ''}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="size-16 shrink-0 rounded-xl object-cover"
                    />
                  )}
                  <span className="flex h-full min-w-0 flex-1 flex-col justify-between gap-2">
                    <span className="line-clamp-2 leading-tight font-bold">{product.name}</span>
                    <span className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-extrabold text-primary">
                        {formatCOP(product.price)}
                      </span>
                      {soldOut ? (
                        <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-bold text-danger">
                          Agotado
                        </span>
                      ) : product.portionsLeft === null ? null : (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent-soft-foreground">
                          Quedan {product.portionsLeft}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
