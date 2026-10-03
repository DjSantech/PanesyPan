import { tutorial } from '../lib/tutorial';

tutorial({
  file: '13-ajustes',
  part: 'Administración',
  title: 'Ajustes: tiquete, mesas y topes',
  introVoice: 'Administración. Ajustes: tiquete, mesas y topes.',
  role: 'admin',
  start: {
    path: '/configuracion',
    ready: (page) => page.getByRole('button', { name: 'Guardar configuración' }),
  },
  outro: {
    text: 'Ya sabes configurar el tiquete, las mesas y los topes de la caja.',
    voice:
      'Listo. Ya sabes configurar el tiquete, las mesas y los topes de la caja. Con esto terminas la serie de videos del sistema.',
  },

  async script(d) {
    const { page } = d;

    await d.say('En **Ajustes** configuras el tiquete y las reglas del punto de venta.', {
      voice: 'En ajustes configuras el tiquete y las reglas del punto de venta.',
    });
    await d.say('Escribe los datos del negocio que salen impresos en el tiquete.', {
      during: async () => {
        await d.type(page.getByLabel('Dirección'), 'Cra. 16 # 20-30, Dosquebradas');
        await d.type(page.getByLabel('Teléfono'), '310 000 0000');
      },
    });
    await d.scrollTo(page.getByRole('radiogroup', { name: 'Ancho del papel' }));
    await d.say('Elige el ancho del papel de tu impresora: 58 u 80 milímetros.', {
      focus: page.getByRole('radiogroup', { name: 'Ancho del papel' }),
    });
    await d.scrollTo(page.getByLabel('Número de mesas'));
    await d.say('**Número de mesas** del local.', {
      voice: 'Número de mesas del local.',
      focus: page.getByLabel('Número de mesas'),
    });
    await d.say(
      'Hasta qué **descuento** puede dar una cajera sin pedir el PIN del administrador.',
      {
        voice: 'Hasta qué descuento puede dar una cajera sin pedir el PIN del administrador.',
        focus: page.getByLabel('Descuento máximo sin autorización (%)'),
      },
    );
    await d.say('Y el **egreso** máximo que puede sacar de la caja sin autorización.', {
      voice: 'Y el egreso máximo que puede sacar de la caja sin autorización.',
      focus: page.getByLabel('Egreso máximo sin autorización'),
    });
    await d.scrollTo(page.getByRole('button', { name: 'Guardar configuración' }));
    await d.say('Toca **Guardar configuración**.', {
      voice: 'Toca guardar configuración.',
      during: () => d.tap(page.getByRole('button', { name: 'Guardar configuración' })),
    });
    await d.scrollTo(page.getByRole('complementary', { name: 'Vista previa del tiquete' }));
    await d.say('Abajo ves cómo queda el tiquete antes de imprimir.', {
      focus: page.getByRole('complementary', { name: 'Vista previa del tiquete' }),
    });
  },
});
