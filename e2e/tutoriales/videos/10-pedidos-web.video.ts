import { addDemoProducts, openShift, placeWebOrder, publishTodayMenu } from '../lib/scenario';
import { tutorial } from '../lib/tutorial';

tutorial({
  file: '10-pedidos-web',
  part: 'Pedidos web',
  title: 'Pedidos a domicilio desde panesypan.com',
  introVoice: 'Pedidos web. Pedidos a domicilio desde panes y pan punto com.',
  role: 'cashier',
  start: { path: '/pedidos-web', ready: (page) => page.getByText('Pedido #1') },
  async prepare(demo) {
    await addDemoProducts(demo.admin);
    await publishTodayMenu(demo.admin);
    const cashier = await demo.cashier();
    await openShift(cashier);
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
        note: 'Timbre dañado, llamar al llegar',
      },
    );
    return undefined;
  },
  outro: {
    text: 'Ya sabes atender un pedido web: confirmar, despachar y cobrar.',
    next: 'Usuarios: cajeras, claves y PIN',
    voice:
      'Listo. Ya sabes atender un pedido web: confirmar, despachar y cobrar. En el siguiente video: los usuarios.',
  },

  async script(d) {
    const { page } = d;
    const order = page.locator('div.rounded-2xl', { has: page.getByText('Pedido #1') }).last();

    await d.say('Cuando un cliente pide desde la página web, el pedido llega aquí.', {
      focus: page.getByRole('link', { name: /Pedidos/ }),
    });
    await d.say('El número rojo avisa cuántos pedidos están pendientes.');
    await d.say('Ves qué pidió, el total, la dirección y la nota del cliente.', {
      focus: order,
    });
    await d.say('Con **WhatsApp** o el teléfono le escribes o lo llamas si hace falta.', {
      voice: 'Con WhatsApp o el teléfono le escribes o lo llamas si hace falta.',
      focus: order.getByRole('link', { name: /WhatsApp/ }),
    });

    await d.say('Si puedes atenderlo, toca **Confirmar**.', {
      voice: 'Si puedes atenderlo, toca confirmar.',
      during: () => d.tap(order.getByRole('button', { name: 'Confirmar' })),
    });
    await d.say('Toca **Imprimir** para la comanda de la cocina.', {
      voice: 'Toca imprimir para la comanda de la cocina.',
      during: async () => {
        await d.tap(order.getByRole('button', { name: 'Imprimir' }));
        await d.waitForTicket();
      },
    });
    await d.wait(1_200);
    await d.closeTicket();
    await d.say('Cuando sale con el domiciliario, toca **Despachar**.', {
      voice: 'Cuando sale con el domiciliario, toca despachar.',
      during: () => d.tap(order.getByRole('button', { name: 'Despachar' })),
    });

    await d.say('Al recibir la plata, toca **Cobrar**.', {
      voice: 'Al recibir la plata, toca cobrar.',
      during: () => d.tap(order.getByRole('button', { name: 'Cobrar' })),
    });
    const checkout = page.getByRole('dialog', { name: 'Cobrar pedido #1' });
    await d.say('Escribe el valor del domicilio. Lo cobra el domiciliario y no suma al total.', {
      during: () => d.type(checkout.getByLabel('Domicilio (lo cobra el domiciliario)'), '3000'),
    });
    await d.say('Elige cómo pagó y toca **Cobrar**. La venta queda en tu caja.', {
      voice: 'Elige cómo pagó y toca cobrar. La venta queda en tu caja.',
      during: () => d.tap(checkout.getByRole('button', { name: /^Cobrar \$/ })),
    });
    const done = page.getByRole('dialog', { name: /Venta N\.º \d+ registrada/ });
    await d.tap(done.getByRole('button', { name: /Nueva venta|Listo|Cerrar/ }).first());
    await d.say('El pedido queda **entregado**. Con los filtros ves los pedidos por estado.', {
      voice: 'El pedido queda entregado. Con los filtros ves los pedidos por estado.',
      focus: page.getByRole('radiogroup', { name: 'Filtrar por estado' }),
    });
    await d.say('Si no se puede atender, **Cancelar** pide el motivo antes de cobrar.', {
      voice: 'Si no se puede atender, cancelar pide el motivo antes de cobrar.',
    });
  },
});
