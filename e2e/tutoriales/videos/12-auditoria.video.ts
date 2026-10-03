import { PEOPLE } from '../lib/demo';
import { addDemoProducts, openShift, publishTodayMenu, sellSomeOrders } from '../lib/scenario';
import { tutorial } from '../lib/tutorial';

tutorial({
  file: '12-auditoria',
  part: 'Administración',
  title: 'Auditoría: quién hizo qué y cuándo',
  introVoice: 'Administración. Auditoría: quién hizo qué y cuándo.',
  role: 'admin',
  start: { path: '/auditoria', ready: (page) => page.getByLabel('Acción') },
  async prepare(demo) {
    await addDemoProducts(demo.admin);
    await publishTodayMenu(demo.admin);
    // Un intento de ingreso con la clave equivocada (queda registrado en la auditoría).
    await demo.admin.send('POST', '/api/v1/auth/login', {
      identifier: PEOPLE.cashier.username,
      password: 'clave-equivocada',
    });
    const cashier = await demo.cashier();
    await openShift(cashier);
    await sellSomeOrders(cashier);
    return undefined;
  },
  outro: {
    text: 'Ya sabes revisar la auditoría y filtrar por acción y por fechas.',
    next: 'Ajustes: tiquete, mesas y topes',
    voice:
      'Listo. Ya sabes revisar la auditoría y filtrar por acción y por fechas. En el siguiente video: los ajustes.',
  },

  async script(d) {
    const { page } = d;

    await d.say('La **Auditoría** guarda todo lo importante, con el nombre y la hora.', {
      voice: 'La auditoría guarda todo lo importante, con el nombre y la hora.',
    });
    await d.say('Ingresos, ventas, anulaciones, aperturas y cierres de caja, cambios de precio…', {
      voice: 'Ingresos, ventas, anulaciones, aperturas y cierres de caja, cambios de precio.',
      during: () => d.scrollTo(page.getByRole('listitem').nth(4)),
    });
    await d.say(
      'Lo sospechoso, como muchos intentos con la clave equivocada, sale como **alerta**.',
      {
        voice: 'Lo sospechoso, como muchos intentos con la clave equivocada, sale como alerta.',
      },
    );
    await d.scrollTo(page.getByLabel('Acción'));
    await d.say('Para buscar algo, filtra por **acción**…', {
      voice: 'Para buscar algo, filtra por acción.',
      focus: page.getByLabel('Acción'),
    });
    await d.say('…o por fechas, con **Desde** y **Hasta**.', {
      voice: 'O por fechas, con desde y hasta.',
      focus: page.getByLabel('Desde'),
    });
    await d.say('Nadie puede borrar ni cambiar estos registros.');
  },
});
