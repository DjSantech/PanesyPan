import type { Page } from '@playwright/test';
import {
  addDemoProducts,
  makeLowStock,
  openShift,
  placeWebOrder,
  publishTodayMenu,
  sellSomeOrders,
} from '../lib/scenario';
import { tutorial } from '../lib/tutorial';

/** Tarjeta (la más interna) que contiene el texto. */
const card = (page: Page, text: string) =>
  page.locator('div.rounded-2xl', { has: page.getByText(text, { exact: true }) }).last();

tutorial({
  file: '02-inicio',
  part: 'Administración',
  title: 'Inicio: el resumen del día',
  introVoice: 'Administración. Inicio: el resumen del día.',
  role: 'admin',
  start: { path: '/', ready: (page) => page.getByRole('heading', { name: 'Hola, Marta' }) },
  async prepare(demo) {
    await addDemoProducts(demo.admin);
    await publishTodayMenu(demo.admin);
    await makeLowStock(demo.admin, 'Pan Gallego', 4, 10);
    const cashier = await demo.cashier();
    await openShift(cashier);
    await sellSomeOrders(cashier);
    await placeWebOrder(
      cashier,
      [
        ['Pan de Bono', 6],
        ['Chocolate', 2],
      ],
      {
        name: 'Carolina Mejía',
        phone: '3104567890',
        address: 'Calle 45 # 12-30, apto 201',
        neighborhood: 'Los Naranjos',
      },
    );
    return undefined;
  },
  outro: {
    text: 'Ya sabes leer el resumen del día y entrar a cada sección desde el inicio.',
    next: 'Vender · Parte 1: abrir la caja y vender en mostrador',
    voice:
      'Listo. Ya sabes leer el resumen del día y entrar a cada sección desde el inicio. Sigue con el video de vender.',
  },

  async script(d) {
    const { page } = d;

    await d.say('**Inicio** es el panel del administrador: todo lo que pasa hoy en la panadería.', {
      voice: 'Inicio es el panel del administrador: todo lo que pasa hoy en la panadería.',
      focus: page.getByRole('heading', { name: 'Hola, Marta' }),
    });
    await d.say('Se actualiza solo, en vivo, cada vez que alguien vende.', {
      focus: page.getByRole('heading', { name: 'Resumen de hoy' }),
    });
    await d.say('Aquí ves cuánto se ha vendido hoy, cuántas ventas y el promedio.', {
      focus: card(page, 'Ventas de hoy'),
    });
    await d.say('El **efectivo** que debería haber en las cajas abiertas…', {
      voice: 'El efectivo que debería haber en las cajas abiertas.',
      focus: card(page, 'Efectivo en cajas'),
    });
    await d.say('…y los productos que están por agotarse.', {
      voice: 'Y los productos que están por agotarse.',
      focus: card(page, 'Bajo stock'),
    });
    await d.say('También separa lo vendido en el local y lo de los pedidos web.', {
      focus: card(page, 'Ventas de pedidos web'),
    });

    await d.scrollTo(page.getByText('Ventas por hora', { exact: true }).first());
    await d.say('**Ventas por hora**: muestra a qué horas se vende más.', {
      voice: 'Ventas por hora: muestra a qué horas se vende más.',
      focus: card(page, 'Ventas por hora'),
    });
    await d.scrollTo(page.getByText('Medios de pago', { exact: true }).first());
    await d.say('Cuánto entró en efectivo, Nequi, Daviplata o tarjeta.', {
      focus: card(page, 'Medios de pago'),
    });
    await d.scrollTo(page.getByText('Lo más vendido', { exact: true }).first());
    await d.say('**Lo más vendido** del día, para planear la producción.', {
      voice: 'Lo más vendido del día, para planear la producción.',
      focus: card(page, 'Lo más vendido'),
    });
    await d.scrollTo(page.getByText('Cajas abiertas', { exact: true }).first());
    await d.say('Qué cajas están abiertas ahora y quién las tiene.', {
      focus: card(page, 'Cajas abiertas'),
    });
    await d.scrollTo(page.getByText('Alertas de inventario', { exact: true }).first());
    await d.say('Las **alertas de inventario** avisan qué hay que hornear.', {
      voice: 'Las alertas de inventario avisan qué hay que hornear.',
      focus: card(page, 'Alertas de inventario'),
    });
    await d.scrollTo(page.getByText('Exportar reportes', { exact: true }).first());
    await d.say('Y con **Exportar reportes** descargas las ventas en Excel para el contador.', {
      voice: 'Y con exportar reportes descargas las ventas en Excel para el contador.',
      focus: card(page, 'Exportar reportes'),
    });

    await d.scrollTo(page.getByRole('link', { name: /Usuarios/ }));
    await d.say('Más abajo están los accesos a todas las secciones del sistema.', {
      focus: page.getByRole('link', { name: /Usuarios/ }),
    });
    await d.say('Cada una tiene su propio video en esta serie.');
  },
});
