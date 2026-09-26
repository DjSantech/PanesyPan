import { PageHeading } from '@/components/PageHeading';
import { getDailyMenu } from '@/lib/api';
import type { DailyMenuOption } from '@/lib/types';
import { formatCOP } from '@panesypan/shared';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Menú del día',
  description: 'Almuerzo casero de hoy: sopas, principios, proteínas y jugo.',
};

function formatDate(date: string): string {
  // El día de negocio viene como AAAA-MM-DD; se fija el mediodía UTC para no cambiar de día.
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function OptionGroup({ title, options }: { title: string; options: DailyMenuOption[] }) {
  if (options.length === 0) return null;
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="mb-3 text-xl font-bold">{title}</h2>
      <ul className="space-y-1">
        {options.map((o) => (
          <li key={o.name}>
            {o.isAvailable ? (
              o.name
            ) : (
              <>
                <s className="text-muted-foreground">{o.name}</s>
                <span className="ml-2 text-sm font-semibold text-danger">Agotado</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function DailyMenuPage() {
  const { date, menu } = await getDailyMenu();

  return (
    <>
      <PageHeading title="Menú del día">
        <span className="capitalize">{formatDate(date)}</span>
      </PageHeading>
      {menu === null ? (
        <p className="rounded-xl border bg-card p-6 text-lg">
          Hoy todavía no hemos publicado el menú. Vuelve a consultar más tarde.
        </p>
      ) : (
        <div className="space-y-6">
          {menu.items.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {menu.items.map((item) => (
                <li
                  key={item.productId}
                  className="flex items-center justify-between gap-3 rounded-xl bg-accent-soft p-4 text-accent-soft-foreground"
                >
                  <span className={`text-lg font-bold ${item.soldOut ? 'line-through' : ''}`}>
                    {item.name}
                  </span>
                  {item.soldOut ? (
                    <span className="font-semibold text-danger">Agotado</span>
                  ) : (
                    item.price !== null && (
                      <span className="text-lg font-bold">{formatCOP(item.price)}</span>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-4 md:grid-cols-3">
            <OptionGroup title="Sopas" options={menu.soups} />
            <OptionGroup title="Principios" options={menu.principles} />
            <OptionGroup title="Proteínas" options={menu.proteins} />
          </div>
          {menu.juice && (
            <p className="text-lg">
              <strong>Jugo:</strong> {menu.juice}
            </p>
          )}
          {menu.notes && <p className="text-muted-foreground">{menu.notes}</p>}
        </div>
      )}
    </>
  );
}
