import { tutorial } from '../lib/tutorial';

tutorial({
  file: '03-vender-1',
  part: 'Vender · Parte 1 de 3',
  title: 'Abrir la caja y vender en mostrador',
  introVoice: 'Vender, parte uno. Abrir la caja y vender en mostrador.',
  role: 'cashier',
  start: { path: '/vender', ready: (page) => page.getByRole('heading', { name: 'Abrir caja' }) },
  outro: {
    text: 'Ya sabes abrir la caja y vender en mostrador.',
    next: 'Vender · Parte 2: mesas, pago combinado y descuentos',
    voice:
      'Listo. Ya sabes abrir la caja y vender en mostrador. En el siguiente video: mesas, pago combinado y descuentos.',
  },

  async script(d) {
    const { page } = d;
    const product = (name: string) =>
      page.getByRole('list', { name: 'Productos' }).getByRole('button', { name });
    const orderBar = page.getByRole('button', { name: /Ver pedido/ });

    // ── Apertura de caja ──
    await d.say('Al empezar el turno, Vender te pide **abrir la caja**.', {
      voice: 'Al empezar el turno, la pantalla de vender te pide abrir la caja.',
      focus: page.getByRole('heading', { name: 'Abrir caja' }),
    });
    await d.say('Cuenta el efectivo con el que empiezas (la **base**) y escríbelo aquí.', {
      voice: 'Cuenta el efectivo con el que empiezas, la base, y escríbelo aquí.',
      during: () => d.type(page.getByLabel('Base inicial en efectivo'), '100000'),
    });
    await d.say('Luego toca **Abrir caja**.', {
      during: () => d.tap(page.getByRole('button', { name: 'Abrir caja' })),
    });
    await d.say('¡Listo! La caja quedó abierta y ya puedes vender.', {
      voice: 'Listo. La caja quedó abierta y ya puedes vender.',
    });

    // ── Armar el pedido ──
    await d.say('Arriba eliges el tipo de venta. Para llevar, deja **Mostrador**.', {
      focus: page.getByRole('radiogroup', { name: 'Tipo de venta' }),
    });
    await d.say('En **Favoritos** están los productos que más se venden.', {
      focus: page.getByRole('radiogroup', { name: 'Categoría' }),
    });
    await d.say('Toca un producto para agregarlo al pedido. Cada toque suma uno.', {
      during: async () => {
        await d.tap(product('Pan de Bono, $ 2.000'));
        await d.tap(product('Pan de Bono, $ 2.000'));
        await d.tap(product('Croissant, $ 3.000'));
      },
    });
    await d.say('Abajo ves cuántos productos llevas y el total.', { focus: orderBar });
    await d.say('¿No está en Favoritos? Búscalo por el nombre.', {
      voice: 'Si no está en favoritos, búscalo por el nombre.',
      during: async () => {
        await d.type(page.getByRole('searchbox', { name: 'Buscar producto' }), 'palitos');
        await d.tap(product('Palitos de Queso, $ 1.000'));
      },
    });
    await d.tap(page.getByRole('radio', { name: 'Favoritos' }));

    // ── Revisar el pedido ──
    await d.say('Toca **Ver pedido** para revisarlo.', { during: () => d.tap(orderBar) });
    const order = page.getByRole('dialog', { name: 'Pedido de mostrador' });
    await d.say('Con **+** y **−** cambias la cantidad, y con la caneca quitas el producto.', {
      voice: 'Con más y menos cambias la cantidad, y con la caneca quitas el producto.',
      focus: order.getByRole('listitem').filter({ hasText: 'Croissant' }),
    });
    await d.say('¿Piden otro croissant? Toca **+**.', {
      voice: 'Si piden otro croissant, toca más.',
      during: () => d.tap(order.getByRole('button', { name: 'Agregar uno de Croissant' })),
    });
    await d.say('Cuando el pedido esté listo, toca **Cobrar**.', {
      during: () => d.tap(order.getByRole('button', { name: 'Cobrar $ 11.000' })),
    });

    // ── Cobro en efectivo ──
    const checkout = page.getByRole('dialog', { name: 'Cobrar pedido' });
    await d.say('Elige cómo paga: efectivo, Nequi, Daviplata, tarjeta o transferencia.', {
      focus: checkout.getByRole('radiogroup', { name: 'Medio de pago' }),
    });
    await d.say('Si paga en efectivo, toca el billete con el que te paga.', {
      during: () => d.tap(checkout.getByRole('button', { name: '$ 20.000' })),
    });
    await d.say('El sistema calcula el **cambio** solo.', {
      voice: 'El sistema calcula el cambio solo: nueve mil pesos.',
      focus: checkout.getByText('Cambio', { exact: true }).locator('..'),
    });
    await d.say('Toca **Cobrar** para registrar la venta.', {
      during: () => d.tap(checkout.getByRole('button', { name: 'Cobrar $ 11.000' })),
    });

    // ── Venta registrada y tiquete ──
    const done = page.getByRole('dialog', { name: /Venta N\.º \d+ registrada/ });
    await d.say('Venta registrada. Entrega el cambio que ves en grande.', {
      focus: done.getByText('Cambio', { exact: true }).locator('..'),
    });
    await d.say('Si el cliente quiere el tiquete, toca **Imprimir tiquete**.', {
      during: async () => {
        await d.tap(done.getByRole('button', { name: 'Imprimir tiquete' }));
        await d.waitForTicket();
      },
    });
    await d.say('Así sale el tiquete en la impresora.', { pause: 1_200 });
    await d.closeTicket();
    await d.say('Toca **Nueva venta** para atender al siguiente cliente.', {
      during: () => d.tap(done.getByRole('button', { name: 'Nueva venta' })),
    });

    // ── Venta por Nequi ──
    await d.say('Ahora, una venta pagada por **Nequi**.', {
      during: async () => {
        await d.tap(product('Almojábana, $ 2.000'));
        await d.tap(product('Buñuelo, $ 1.500'));
        await d.tap(product('Buñuelo, $ 1.500'));
      },
    });
    await d.tap(orderBar);
    await d.tap(order.getByRole('button', { name: 'Cobrar $ 5.000' }));
    await d.say('Elige **Nequi**. Si quieres, anota la referencia del comprobante.', {
      during: async () => {
        await d.tap(checkout.getByRole('radio', { name: 'Nequi' }));
        await d.highlight(checkout.getByLabel('Referencia o comprobante (opcional)'));
      },
    });
    await d.say('Revisa que el pago sí haya llegado y toca **Cobrar**.', {
      during: () => d.tap(checkout.getByRole('button', { name: 'Cobrar $ 5.000' })),
    });
    await d.say('Venta lista. Toca **Nueva venta** para seguir vendiendo.', {
      during: () => d.tap(done.getByRole('button', { name: 'Nueva venta' })),
    });
  },
});
