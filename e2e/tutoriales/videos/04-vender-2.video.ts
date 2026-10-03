import { addDemoProducts, openShift, publishTodayMenu } from '../lib/scenario';
import { tutorial } from '../lib/tutorial';

tutorial({
  file: '04-vender-2',
  part: 'Vender · Parte 2 de 3',
  title: 'Mesas, almuerzos, descuentos y pago combinado',
  introVoice: 'Vender, parte dos. Mesas, almuerzos, descuentos y pago combinado.',
  role: 'cashier',
  start: {
    path: '/vender',
    ready: (page) => page.getByRole('radiogroup', { name: 'Tipo de venta' }),
  },
  async prepare(demo) {
    await addDemoProducts(demo.admin);
    await publishTodayMenu(demo.admin);
    await openShift(await demo.cashier());
    return undefined;
  },
  outro: {
    text: 'Ya sabes atender mesas, vender almuerzos, dar descuentos y cobrar con dos medios de pago.',
    next: 'Vender · Parte 3: egresos, retiros y cierre de caja',
    voice:
      'Listo. Ya sabes atender mesas, vender almuerzos, dar descuentos y cobrar con dos medios de pago. En el siguiente video: egresos, retiros y el cierre de caja.',
  },

  async script(d) {
    const { page } = d;
    const product = (name: string) =>
      page.getByRole('list', { name: 'Productos' }).getByRole('button', { name });
    const chip = (name: string) =>
      page.getByRole('radiogroup', { name: 'Categoría' }).getByRole('radio', { name });

    // ── Abrir una mesa ──
    await d.say('Si el cliente se sienta, toca **Mesas**.', {
      during: () => d.tap(page.getByRole('radio', { name: /^Mesas/ })),
    });
    await d.say('Las mesas libres tienen el borde punteado. Toca la mesa del cliente.', {
      focus: page.getByRole('list', { name: 'Mesas' }),
    });
    await d.tap(page.getByRole('button', { name: 'Mesa 3, libre' }));
    await d.say('Ahora todo lo que toques se agrega a la **mesa 3**.', {
      voice: 'Ahora todo lo que toques se agrega a la mesa tres.',
      focus: page.getByText('Agregando a la mesa 3'),
    });

    // ── Almuerzo ──
    await d.say('Los **almuerzos** salen cuando el menú del día está publicado.', {
      voice: 'Los almuerzos salen cuando el menú del día está publicado.',
      during: async () => {
        await d.tap(chip('Almuerzos'));
        await d.tap(product('Almuerzo corriente, $ 15.000'));
      },
    });
    const lunch = page.getByRole('dialog', { name: 'Almuerzo corriente' });
    await d.say('Elige la proteína, el principio, la sopa y la bebida que pide el cliente.', {
      during: async () => {
        await d.tap(
          lunch
            .getByRole('radiogroup', { name: '1. Proteína' })
            .getByRole('radio', { name: 'Pollo asado' }),
        );
        await d.tap(
          lunch
            .getByRole('radiogroup', { name: '2. Principio' })
            .getByRole('radio', { name: 'Fríjoles' }),
        );
        await d.tap(
          lunch
            .getByRole('radiogroup', { name: '3. Sopa (va incluida)' })
            .getByRole('radio', { name: 'Sancocho' }),
        );
        await d.tap(
          lunch
            .getByRole('radiogroup', { name: '4. Bebida (va incluida)' })
            .getByRole('radio', { name: 'Limonada' }),
        );
      },
    });
    await d.say('Toca **Agregar almuerzo**.', {
      during: () => d.tap(lunch.getByRole('button', { name: /Agregar almuerzo/ })),
    });
    await d.say('Agrega lo demás que pidan. Cualquier compañera puede sumarle cosas a la mesa.', {
      during: async () => {
        await d.tap(chip('Favoritos'));
        await d.tap(product('Pan de Bono, $ 2.000'));
        await d.tap(product('Pan de Bono, $ 2.000'));
      },
    });

    // ── Volver a las mesas ──
    await d.say('Con **Mesas** vuelves a ver todas las cuentas abiertas.', {
      voice: 'Con el botón mesas vuelves a ver todas las cuentas abiertas.',
      during: () => d.tap(page.getByRole('button', { name: 'Mesas', exact: true })),
    });
    await d.say('La mesa 3 queda ocupada con su cuenta hasta que se cobre.', {
      voice: 'La mesa tres queda ocupada con su cuenta hasta que se cobre.',
      focus: page.getByRole('button', { name: /Mesa 3, cuenta de/ }),
    });

    // ── Cobrar la mesa ──
    await d.say('Cuando se van, abre la mesa y toca **Ver pedido**.', {
      voice: 'Cuando se van, abre la mesa y toca ver pedido.',
      during: async () => {
        await d.tap(page.getByRole('button', { name: /Mesa 3, cuenta de/ }));
        await d.tap(page.getByRole('button', { name: /Ver pedido/ }));
      },
    });
    const tab = page.getByRole('dialog', { name: 'Mesa 3' });
    await d.say('Aquí puedes **cambiar de mesa** o **cancelar** la cuenta si hace falta.', {
      voice: 'Aquí puedes cambiar de mesa o cancelar la cuenta si hace falta.',
      focus: tab.getByRole('button', { name: 'Cambiar mesa' }),
    });
    await d.say('Toca **Cobrar**.', {
      during: () => d.tap(tab.getByRole('button', { name: 'Cobrar $ 19.000' })),
    });

    // ── Descuento ──
    const checkout = page.getByRole('dialog', { name: 'Cobrar mesa 3' });
    await d.say('Para un descuento, toca **Descuento**.', {
      during: () => d.tap(checkout.getByRole('button', { name: 'Descuento' })),
    });
    await d.say('Escribe el porcentaje y el motivo. Por ejemplo, 10 % a un cliente frecuente.', {
      voice:
        'Escribe el porcentaje y el motivo. Por ejemplo, diez por ciento a un cliente frecuente.',
      during: async () => {
        await d.type(checkout.getByRole('textbox', { name: 'Porcentaje' }), '10');
        await d.type(checkout.getByLabel('Motivo'), 'Cliente frecuente');
      },
    });
    await d.say('Si pasa del tope permitido, un administrador debe poner su **PIN**.', {
      voice: 'Si pasa del tope permitido, un administrador debe poner su PIN.',
      focus: checkout.getByText(/sin autorización|PIN de un administrador/),
    });

    // ── Pago combinado ──
    await d.say('Si pagan una parte en efectivo y otra por Nequi, toca **Pago combinado**.', {
      voice: 'Si pagan una parte en efectivo y otra por Nequi, toca pago combinado.',
      during: () => d.tap(checkout.getByRole('button', { name: 'Pago combinado' })),
    });
    await d.say('Escribe cuánto va por cada medio.', {
      during: async () => {
        await d.type(checkout.getByRole('textbox', { name: 'Efectivo' }), '10000');
        await d.type(checkout.getByRole('textbox', { name: 'Nequi' }), '7100');
      },
    });
    await d.say('Cuando los pagos cuadran con el total, toca **Cobrar**.', {
      voice: 'Cuando los pagos cuadran con el total, toca cobrar.',
      focus: checkout.getByText('Los pagos cuadran con el total'),
    });
    await d.tap(checkout.getByRole('button', { name: 'Cobrar $ 17.100' }));
    const done = page.getByRole('dialog', { name: /Venta N\.º \d+ registrada/ });
    await d.say('Venta registrada, y la mesa 3 queda libre otra vez.', {
      voice: 'Venta registrada, y la mesa tres queda libre otra vez.',
      during: () => d.tap(done.getByRole('button', { name: 'Nueva venta' })),
    });
  },
});
