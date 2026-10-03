import { PEOPLE } from '../lib/demo';
import { addDemoProducts, openShift, publishTodayMenu, sellSomeOrders } from '../lib/scenario';
import { tutorial } from '../lib/tutorial';

tutorial({
  file: '06-ventas',
  part: 'Ventas',
  title: 'Revisar, reimprimir y anular ventas',
  introVoice: 'Ventas. Revisar, reimprimir y anular ventas.',
  role: 'cashier',
  start: { path: '/ventas', ready: (page) => page.getByRole('list', { name: 'Lista de ventas' }) },
  async prepare(demo) {
    await addDemoProducts(demo.admin);
    await publishTodayMenu(demo.admin);
    const cashier = await demo.cashier();
    await openShift(cashier);
    await sellSomeOrders(cashier);
    return undefined;
  },
  outro: {
    text: 'Ya sabes revisar las ventas del turno, reimprimir un tiquete y anular una venta.',
    next: 'Catálogo: productos, precios y agotados',
    voice:
      'Listo. Ya sabes revisar las ventas del turno, reimprimir un tiquete y anular una venta. En el siguiente video: el catálogo.',
  },

  async script(d) {
    const { page } = d;
    const list = page.getByRole('list', { name: 'Lista de ventas' });

    await d.say('En **Ventas** está todo lo que has vendido en tu caja.', {
      voice: 'En ventas está todo lo que has vendido en tu caja.',
    });
    await d.say('Arriba, el resumen: la base, lo vendido y el efectivo que debe haber.', {
      focus: page.getByText('Efectivo esperado', { exact: true }).locator('..'),
    });
    await d.say('Y cuánto entró por cada medio de pago.', {
      focus: page.getByRole('list', { name: 'Por medio de pago' }),
    });
    await d.scrollTo(list);
    await d.say('Abajo está la lista. Toca una venta para ver el detalle.', {
      during: () => d.tap(list.getByRole('button').first()),
    });
    const detail = page.getByRole('dialog', { name: /Venta N\.º/ });
    await d.say('Ves los productos, el total y cómo pagó el cliente.', {
      focus: detail.getByText('Total', { exact: true }).locator('..'),
    });

    // ── Reimprimir ──
    await d.say('Si te piden el tiquete otra vez, toca **Reimprimir tiquete**.', {
      voice: 'Si te piden el tiquete otra vez, toca reimprimir tiquete.',
      during: async () => {
        await d.tap(detail.getByRole('button', { name: 'Reimprimir tiquete' }));
        await d.waitForTicket();
      },
    });
    await d.wait(1_500);
    await d.closeTicket();

    // ── Anular ──
    await d.say('¿Se cobró mal? Toca **Anular venta**.', {
      voice: 'Si se cobró mal, toca anular venta.',
      during: () => d.tap(detail.getByRole('button', { name: 'Anular venta' })),
    });
    await d.say('Escribe el motivo…', {
      voice: 'Escribe el motivo.',
      during: () =>
        d.type(detail.getByLabel('Motivo de la anulación'), 'Se cobró el producto equivocado'),
    });
    await d.say('…y un administrador autoriza con su **PIN**.', {
      voice: 'Y un administrador autoriza con su PIN.',
      during: async () => {
        await d.tap(detail.getByRole('button', { name: 'Anular venta' }));
        await d.pin(
          PEOPLE.admin.pin,
          page.getByRole('dialog', { name: 'Autorización del administrador' }),
        );
      },
    });
    await d.say('La venta queda **anulada** y el inventario vuelve a su lugar.', {
      voice: 'La venta queda anulada y el inventario vuelve a su lugar.',
    });
    await d.say('Después la vuelves a cobrar bien desde **Vender**.', {
      voice: 'Después la vuelves a cobrar bien desde vender.',
    });
    await d.say('Ojo: solo se puede anular mientras la caja siga abierta.');
  },
});
