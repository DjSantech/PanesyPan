import { addDemoProducts } from '../lib/scenario';
import { tutorial } from '../lib/tutorial';

tutorial({
  file: '08-menu-del-dia',
  part: 'Menú del día',
  title: 'Almuerzos y porciones de hoy',
  introVoice: 'Menú del día. Almuerzos y porciones de hoy.',
  role: 'admin',
  start: {
    path: '/menu-del-dia',
    ready: (page) => page.getByRole('button', { name: 'Guardar menú' }),
  },
  async prepare(demo) {
    await addDemoProducts(demo.admin);
    return undefined;
  },
  outro: {
    text: 'Ya sabes armar y publicar el menú del día para vender los almuerzos.',
    next: 'Inventario: producción, mermas y alertas',
    voice:
      'Listo. Ya sabes armar y publicar el menú del día para vender los almuerzos. En el siguiente video: el inventario.',
  },

  async script(d) {
    const { page } = d;

    await d.say('Los almuerzos solo salen en Vender cuando el **menú del día** está publicado.', {
      voice: 'Los almuerzos solo salen en vender cuando el menú del día está publicado.',
    });
    await d.say('Cada mañana el administrador escribe qué hay hoy. Empieza por la **sopa**.', {
      voice: 'Cada mañana el administrador escribe qué hay hoy. Empieza por la sopa.',
      during: async () => {
        await d.tap(page.getByRole('button', { name: 'Agregar sopa' }));
        await d.type(page.getByLabel('Sopa 1'), 'Sancocho');
      },
    });
    await d.say('Luego el **principio**…', {
      voice: 'Luego el principio.',
      during: async () => {
        await d.tap(page.getByRole('button', { name: 'Agregar principio' }));
        await d.type(page.getByLabel('Principio 1'), 'Fríjoles');
      },
    });
    await d.say('…las **proteínas** que hay para escoger…', {
      voice: 'Las proteínas que hay para escoger.',
      during: async () => {
        await d.tap(page.getByRole('button', { name: 'Agregar proteína' }));
        await d.type(page.getByLabel('Proteína 1'), 'Pollo asado');
        await d.tap(page.getByRole('button', { name: 'Agregar proteína' }));
        await d.type(page.getByLabel('Proteína 2'), 'Carne en bistec');
      },
    });
    await d.say('…y la **bebida**.', {
      voice: 'Y la bebida.',
      during: async () => {
        await d.tap(page.getByRole('button', { name: 'Agregar bebida' }));
        await d.type(page.getByLabel('Bebida 1'), 'Limonada');
      },
    });
    await d.say('Si algo se acaba, apágalo y deja de salir para escoger.', {
      focus: page.getByRole('switch', { name: 'Pollo asado disponible' }),
    });

    await d.scrollTo(page.getByRole('switch', { name: 'Vender Almuerzo corriente hoy' }));
    await d.say('En **Qué se vende hoy**, activa el almuerzo y escribe cuántas porciones hay.', {
      voice: 'En qué se vende hoy, activa el almuerzo y escribe cuántas porciones hay.',
      during: async () => {
        const sell = page.getByRole('switch', { name: 'Vender Almuerzo corriente hoy' });
        if ((await sell.getAttribute('aria-checked')) !== 'true') await d.tap(sell);
        await d.type(page.getByLabel('Porciones de Almuerzo corriente'), '30');
      },
    });
    await d.say('Si lo dejas vacío, no tiene límite. Al vender, las porciones bajan solas.');

    await d.scrollTo(page.getByRole('button', { name: 'Guardar menú' }));
    await d.say('Activa **Publicar menú** y toca **Guardar menú**.', {
      voice: 'Activa publicar menú y toca guardar menú.',
      during: async () => {
        await d.tap(page.getByRole('switch', { name: 'Publicar menú' }));
        await d.tap(page.getByRole('button', { name: 'Guardar menú' }));
      },
    });
    await d.scrollTo(page.getByText('Hoy hay', { exact: true }));
    await d.say('¡Listo! Arriba ves el resumen, y en Vender ya salen los almuerzos.', {
      voice: 'Listo. Arriba ves el resumen, y en vender ya salen los almuerzos.',
      focus: page
        .locator('div.rounded-2xl', { has: page.getByText('Hoy hay', { exact: true }) })
        .last(),
    });
    await d.say('Al venderlo, la cajera elige la proteína, el principio, la sopa y la bebida.');
  },
});
