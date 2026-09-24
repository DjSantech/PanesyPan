import { formatCOP, formatTimeCO, type Sale } from '@panesypan/shared';
import { Armchair } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/utils';

/** Mesas del local: libres u ocupadas (con su total y desde qué hora). */
export function TablesGrid({
  tableCount,
  tabs,
  busyTable,
  onSelect,
}: {
  tableCount: number;
  tabs: Sale[];
  busyTable: number | null;
  onSelect: (tableNumber: number, tab: Sale | undefined) => void;
}) {
  if (tableCount === 0) {
    return (
      <EmptyState
        icon={Armchair}
        title="No hay mesas configuradas"
        description="El administrador puede definir cuántas mesas hay en Ajustes."
      />
    );
  }
  const byTable = new Map(tabs.map((tab) => [tab.tableNumber, tab]));

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-label="Mesas">
      {Array.from({ length: tableCount }, (_, index) => {
        const tableNumber = index + 1;
        const tab = byTable.get(tableNumber);
        const units = tab?.lines.reduce((sum, line) => sum + line.quantity, 0) ?? 0;
        return (
          <li key={tableNumber}>
            <button
              type="button"
              disabled={busyTable !== null}
              onClick={() => {
                onSelect(tableNumber, tab);
              }}
              aria-label={
                tab === undefined
                  ? `Mesa ${String(tableNumber)}, libre`
                  : `Mesa ${String(tableNumber)}, cuenta de ${formatCOP(tab.total)}`
              }
              className={cn(
                'flex min-h-32 w-full flex-col justify-between gap-2 rounded-2xl border-2 p-4 text-left transition-colors',
                'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60',
                tab === undefined
                  ? 'border-dashed border-border bg-card hover:border-primary/60'
                  : 'border-primary bg-primary/10 hover:bg-primary/15',
                busyTable === tableNumber && 'animate-pulse',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-xl font-extrabold">Mesa {tableNumber}</span>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs font-bold',
                    tab === undefined
                      ? 'bg-muted text-muted-foreground'
                      : 'bg-primary text-primary-foreground',
                  )}
                >
                  {tab === undefined ? 'Libre' : 'Ocupada'}
                </span>
              </span>
              {tab === undefined ? (
                <span className="text-sm text-muted-foreground">Toca para abrir la cuenta</span>
              ) : (
                <span className="grid gap-0.5">
                  <span className="text-2xl font-extrabold">{formatCOP(tab.total)}</span>
                  <span className="text-sm text-muted-foreground">
                    {units} {units === 1 ? 'producto' : 'productos'} · desde{' '}
                    {formatTimeCO(new Date(tab.openedAt))}
                  </span>
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
