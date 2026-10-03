import { addDemoProducts } from '../lib/scenario';
import { tutorial } from '../lib/tutorial';

tutorial({
  file: '07-catalogo',
  part: 'Catálogo',
  title: 'Productos, precios y agotados',
  introVoice: 'Catálogo. Productos, precios y agotados.',
  role: 'admin',
  start: {
    path: '/catalogo',
    ready: (page) => page.getByRole('button', { name: 'Nuevo producto' }),
  },
  async prepare(demo) {
    await addDemoProducts(demo.admin);
    return undefined;
  },
  outro: {
    text: 'Ya sabes crear productos, marcar agotados y organizar las categorías.',
    next: 'Menú del día: almuerzos y porciones',
    voice:
      'Listo. Ya sabes crear productos, marcar agotados y organizar las categorías. En el siguiente video: el menú del día.',
  },

  async script(d) {
    const { page } = d;

    await d.say('En el **Catálogo** están todos los productos con su precio, por categoría.', {
      voice: 'En el catálogo están todos los productos con su precio, por categoría.',
    });
    await d.say('Puedes buscar un producto o filtrar por categoría.', {
      focus: page.getByRole('searchbox', { name: 'Buscar producto' }),
    });

    // ── Nuevo producto ──
    await d.say('Para crear uno, toca **Nuevo producto**.', {
      voice: 'Para crear uno, toca nuevo producto.',
      during: () => d.tap(page.getByRole('button', { name: 'Nuevo producto' })),
    });
    const form = page.getByRole('dialog', { name: 'Nuevo producto' });
    await d.say('Con **Elegir foto** le pones una foto, desde la galería o la cámara.', {
      voice: 'Con elegir foto le pones una foto, desde la galería o la cámara.',
      focus: form.getByText('Foto del producto').locator('..'),
    });
    await d.say('Escribe el nombre y el precio final, con impuestos incluidos.', {
      during: async () => {
        await d.type(form.getByLabel('Nombre'), 'Pan de Yuca');
        await d.type(form.getByLabel('Precio'), '2500');
      },
    });
    await d.say('Elige la categoría y escribe una descripción corta para la página web.', {
      during: async () => {
        await d.select(form.getByLabel('Categoría'), 'Productos de queso');
        await d.type(
          form.getByLabel('Descripción (opcional)'),
          'Recién horneado, con queso costeño.',
        );
      },
    });
    await d.scrollTo(form.getByText('Favorito', { exact: true }));
    await d.say(
      '**Favorito** lo pone de primero en Vender. **Mostrar en la web** lo publica en la página.',
      {
        voice: 'Favorito lo pone de primero en vender. Mostrar en la web lo publica en la página.',
        during: () => d.tap(form.getByText('Favorito', { exact: true })),
      },
    );
    await d.scrollTo(form.getByLabel('Unidades disponibles ahora'));
    await d.say('Con **Controlar inventario**, escribe cuántas unidades hay ahora.', {
      voice: 'Con controlar inventario, escribe cuántas unidades hay ahora.',
      during: () => d.type(form.getByLabel('Unidades disponibles ahora'), '40'),
    });
    await d.say('Toca **Crear producto**.', {
      voice: 'Toca crear producto.',
      during: () => d.tap(form.getByRole('button', { name: 'Crear producto' })),
    });

    // ── Agotado ──
    await d.say('Si algo se acaba en el día, apaga **Disponible** y en Vender sale como agotado.', {
      voice: 'Si algo se acaba en el día, apaga disponible y en vender sale como agotado.',
      during: () => d.tap(page.getByRole('switch', { name: 'Croissant disponible' })),
    });
    await d.say('Eso lo puede hacer cualquier cajera. Al día siguiente lo vuelves a encender.');

    // ── Editar ──
    await d.say('Para cambiar el precio o el nombre, toca los **tres puntos** y **Editar**.', {
      voice: 'Para cambiar el precio o el nombre, toca los tres puntos y editar.',
      during: async () => {
        await d.tap(page.getByRole('button', { name: 'Acciones para Pan de Yuca' }));
        await d.highlight(page.getByRole('menuitem', { name: 'Editar' }));
        await d.wait(900);
      },
    });
    await d.press('Escape');

    // ── Categorías ──
    await d.say('Con **Categorías** creas, renombras u ordenas las categorías.', {
      voice: 'Con categorías creas, renombras u ordenas las categorías.',
      during: () => d.tap(page.getByRole('button', { name: 'Categorías' })),
    });
    await d.say('Las flechas cambian el orden en que salen en Vender y en la web.', {
      focus: page
        .getByRole('dialog', { name: 'Categorías' })
        .getByRole('button', { name: /Bajar/ })
        .first(),
    });
    await d.press('Escape');
  },
});
