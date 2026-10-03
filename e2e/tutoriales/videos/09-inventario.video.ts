import { addDemoProducts, makeLowStock } from '../lib/scenario';
import { tutorial } from '../lib/tutorial';

tutorial({
  file: '09-inventario',
  part: 'Inventario',
  title: 'Producción, mermas y alertas',
  introVoice: 'Inventario. Producción, mermas y alertas.',
  role: 'admin',
  start: { path: '/inventario', ready: (page) => page.getByRole('tablist', { name: 'Secciones' }) },
  async prepare(demo) {
    await addDemoProducts(demo.admin);
    await makeLowStock(demo.admin, 'Pan Gallego', 4, 10);
    return undefined;
  },
  outro: {
    text: 'Ya sabes registrar la producción y las mermas, y poner alertas de bajo stock.',
    next: 'Pedidos web: pedidos desde panesypan.com',
    voice:
      'Listo. Ya sabes registrar la producción y las mermas, y poner alertas de bajo stock. En el siguiente video: los pedidos web.',
  },

  async script(d) {
    const { page } = d;
    const tab = (name: string) => page.getByRole('tab', { name });
    const row = (name: string) => page.getByRole('listitem').filter({ hasText: name }).first();

    await d.say('**Inventario** lleva las unidades de pan y de los productos que se cuentan.', {
      voice: 'Inventario lleva las unidades de pan y de los productos que se cuentan.',
    });
    await d.say('Cada venta descuenta sola. Si no alcanza el stock, el sistema no deja vender.', {
      focus: row('Pan Gallego'),
    });
    await d.say('Cuando algo está por agotarse, aparece este aviso.', {
      focus: page.getByText(/está por agotarse|están por agotarse/).locator('..'),
    });

    // ── Producción ──
    await d.say('Lo que sale del horno se suma en **Producción de hoy**.', {
      voice: 'Lo que sale del horno se suma en producción de hoy.',
      during: () => d.tap(tab('Producción de hoy')),
    });
    await d.say('Toca **Producir** en el producto y escribe cuántas unidades salieron.', {
      voice: 'Toca producir en el producto y escribe cuántas unidades salieron.',
      during: async () => {
        await d.tap(row('Pan Gallego').getByRole('button', { name: 'Producir' }));
        await d.type(page.getByLabel('Unidades producidas'), '40');
      },
    });
    await d.say('Toca **Registrar producción**: el stock sube solo.', {
      voice: 'Toca registrar producción: el stock sube solo.',
      during: () =>
        d.tap(page.getByRole('dialog').getByRole('button', { name: 'Registrar producción' })),
    });

    // ── Merma ──
    await d.say('Lo que se daña, se quema o se vence va en **Mermas de hoy**.', {
      voice: 'Lo que se daña, se quema o se vence va en mermas de hoy.',
      during: () => d.tap(tab('Mermas de hoy')),
    });
    await d.say('Toca **Merma**, escribe cuántas unidades se perdieron y el motivo.', {
      voice: 'Toca merma, escribe cuántas unidades se perdieron y el motivo.',
      during: async () => {
        await d.tap(row('Croissant').getByRole('button', { name: 'Merma' }));
        await d.type(page.getByLabel('Unidades perdidas'), '2');
        await d.select(page.getByRole('dialog').getByLabel('Motivo'), 'Quemado');
      },
    });
    await d.tap(page.getByRole('dialog').getByRole('button', { name: 'Registrar merma' }));

    // ── Stock mínimo ──
    await d.say('En **Stock** pones el mínimo de cada producto con los tres puntos.', {
      voice: 'En stock pones el mínimo de cada producto con los tres puntos.',
      during: async () => {
        await d.tap(tab('Stock'));
        await d.tap(page.getByRole('button', { name: 'Acciones para Croissant' }));
        await d.tap(page.getByRole('menuitem', { name: 'Stock mínimo' }));
      },
    });
    await d.say('Escribe con cuántas unidades quieres que te avise, y guarda.', {
      during: async () => {
        await d.type(page.getByLabel('Avisar cuando queden'), '15');
        await d.tap(page.getByRole('button', { name: 'Guardar mínimo' }));
      },
    });
    await d.say('El conteo físico se corrige con **Ajustar por conteo**, en el mismo menú.', {
      voice: 'El conteo físico se corrige con ajustar por conteo, en el mismo menú.',
    });
  },
});
