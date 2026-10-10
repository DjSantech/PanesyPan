import { PEOPLE } from '../lib/demo';
import { addDemoProducts, openShift, publishTodayMenu, sellSomeOrders } from '../lib/scenario';
import { tutorial } from '../lib/tutorial';

tutorial({
  file: '05-vender-3',
  part: 'Vender · Parte 3 de 3',
  title: 'Egresos, retiros y cierre de caja',
  introVoice: 'Vender, parte tres. Egresos, retiros y cierre de caja.',
  role: 'cashier',
  start: {
    path: '/vender',
    ready: (page) => page.getByRole('radiogroup', { name: 'Tipo de venta' }),
  },
  async prepare(demo) {
    await addDemoProducts(demo.admin);
    await publishTodayMenu(demo.admin);
    const cashier = await demo.cashier();
    await openShift(cashier);
    await sellSomeOrders(cashier);
    return undefined;
  },
  outro: {
    text: 'Ya sabes registrar egresos y retiros, y cerrar la caja con el arqueo.',
    next: 'Ventas: buscar, reimprimir y anular',
    voice:
      'Listo. Ya sabes registrar egresos y retiros, y cerrar la caja con el arqueo. En el siguiente video: la pestaña de ventas.',
  },

  async script(d) {
    const { page } = d;
    const cashButton = page.getByRole('button', { name: 'Caja', exact: true });
    const panel = page.getByRole('dialog', { name: 'Caja' });

    // ── La caja ──
    await d.say('El botón **Caja** muestra cuánto efectivo debe haber en el cajón.', {
      voice: 'El botón caja muestra cuánto efectivo debe haber en el cajón.',
      during: () => d.tap(cashButton),
    });
    await d.say('Es la base, más lo vendido en efectivo, menos lo que se saca.', {
      focus: panel.getByText('Efectivo esperado').locator('..'),
    });

    // ── Egreso ──
    await d.say('Si pagas algo con la plata de la caja, toca **Egreso, retiro o ingreso**.', {
      voice: 'Si pagas algo con la plata de la caja, toca egreso, retiro o ingreso.',
      during: () => d.tap(panel.getByRole('button', { name: 'Egreso, retiro o ingreso' })),
    });
    const movement = page.getByRole('dialog', { name: 'Egreso, retiro o ingreso' });
    await d.say('Un **egreso** es un gasto. Elige el **tipo** (hielo, gas, nómina…) y el monto.', {
      voice: 'Un egreso es un gasto. Elige el tipo, por ejemplo hielo, gas o nómina, y el monto.',
      during: async () => {
        await d.tap(movement.getByRole('radio', { name: 'Egreso' }));
        await d.tap(movement.getByRole('button', { name: 'Hielo' }));
        await d.type(movement.getByLabel('Monto'), '5000');
        await d.type(movement.getByLabel('Detalle (opcional)'), 'Para las bebidas');
      },
    });
    await d.tap(movement.getByRole('button', { name: 'Registrar egreso' }));
    await d.wait(800);

    // ── Retiro ──
    await d.say('Un **retiro** es plata que se saca para guardarla.', {
      voice: 'Un retiro es plata que se saca para guardarla.',
      during: async () => {
        await d.tap(cashButton);
        await d.tap(panel.getByRole('button', { name: 'Egreso, retiro o ingreso' }));
        await d.tap(movement.getByRole('radio', { name: 'Retiro' }));
        await d.tap(movement.getByRole('button', { name: 'Guardar en caja fuerte' }));
        await d.type(movement.getByLabel('Monto'), '50000');
      },
    });
    await d.say('El retiro siempre lo autoriza un administrador con su **PIN**.', {
      voice: 'El retiro siempre lo autoriza un administrador con su PIN.',
      during: async () => {
        await d.tap(movement.getByRole('button', { name: 'Registrar retiro' }));
        await d.pin(
          PEOPLE.admin.pin,
          page.getByRole('dialog', { name: 'Autorización del administrador' }),
        );
      },
    });
    await d.wait(800);

    // ── Cierre ──
    await d.say('Al final del turno, cobra o cancela las mesas abiertas y toca **Caja**.', {
      voice: 'Al final del turno, cobra o cancela las mesas abiertas y toca caja.',
      during: () => d.tap(cashButton),
    });
    await d.say('Toca **Cerrar caja**.', {
      during: () => d.tap(panel.getByRole('button', { name: 'Cerrar caja' })),
    });
    const closing = page.getByRole('dialog', { name: 'Cerrar caja' });
    const counts = closing.getByRole('list', { name: 'Conteo por denominación' });
    await d.say('Cuenta los billetes y las monedas, y escribe cuántos hay de cada uno.', {
      during: async () => {
        await d.type(counts.getByLabel('$ 50.000', { exact: true }), '1');
        await d.type(counts.getByLabel('$ 20.000', { exact: true }), '1');
        await d.type(counts.getByLabel('$ 10.000', { exact: true }), '1');
        await d.type(counts.getByLabel('$ 2.000', { exact: true }), '1');
      },
    });
    await d.say('El sistema compara lo que contaste con lo que esperaba.', {
      focus: closing.getByText('Contado', { exact: true }).locator('../..'),
    });
    await d.say('Si sobra o falta, te pide una nota explicando. Toca **Cerrar caja**.', {
      voice: 'Si sobra o falta, te pide una nota explicando. Toca cerrar caja.',
      during: () => d.tap(closing.getByRole('button', { name: 'Cerrar caja' })),
    });
    const closed = page.getByRole('dialog', { name: 'Caja cerrada' });
    await d.say('¡Cuadra exacto! Toca **Listo** y entrega la plata.', {
      voice: 'Cuadra exacto. Toca listo y entrega la plata.',
      focus: closed.getByText('Cuadra exacto'),
    });
    await d.tap(closed.getByRole('button', { name: 'Listo' }));
  },
});
