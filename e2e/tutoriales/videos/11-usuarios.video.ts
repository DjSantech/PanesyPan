import { tutorial } from '../lib/tutorial';

tutorial({
  file: '11-usuarios',
  part: 'Administración',
  title: 'Usuarios: cajeras, claves y PIN',
  introVoice: 'Administración. Usuarios: cajeras, claves y PIN.',
  role: 'admin',
  start: {
    path: '/usuarios',
    ready: (page) => page.getByRole('button', { name: 'Nuevo usuario' }),
  },
  outro: {
    text: 'Ya sabes crear usuarios, entregar la clave temporal y restablecer claves o PIN.',
    next: 'Auditoría: quién hizo qué y cuándo',
    voice:
      'Listo. Ya sabes crear usuarios, entregar la clave temporal y restablecer claves o PIN. En el siguiente video: la auditoría.',
  },

  async script(d) {
    const { page } = d;

    await d.say('En **Usuarios** está cada persona que usa el sistema, con su rol.', {
      voice: 'En usuarios está cada persona que usa el sistema, con su rol.',
    });
    await d.say('Para una cajera nueva, toca **Nuevo usuario**.', {
      voice: 'Para una cajera nueva, toca nuevo usuario.',
      during: () => d.tap(page.getByRole('button', { name: 'Nuevo usuario' })),
    });
    const form = page.getByRole('dialog', { name: 'Nuevo usuario' });
    await d.say('Escribe su nombre completo y el usuario con el que va a ingresar.', {
      during: async () => {
        await d.type(form.getByLabel('Nombre completo'), 'Andrea López');
        await d.type(form.getByLabel('Usuario para ingresar'), 'andrea');
      },
    });
    await d.say('El **rol** define qué puede hacer: cajera o administrador.', {
      voice: 'El rol define qué puede hacer: cajera o administrador.',
      focus: form.getByLabel('Rol'),
    });
    await d.say('Toca **Crear usuario**.', {
      voice: 'Toca crear usuario.',
      during: () => d.tap(form.getByRole('button', { name: 'Crear usuario' })),
    });
    const temporary = page.getByRole('dialog', { name: 'Contraseña temporal' });
    await d.say('El sistema crea una **clave temporal**. Entrégasela a la persona.', {
      voice: 'El sistema crea una clave temporal. Entrégasela a la persona.',
      focus: temporary.getByRole('definition').nth(1),
    });
    await d.say('Solo se muestra una vez. En su primer ingreso la cambia y crea su PIN.', {
      during: () => d.tap(temporary.getByRole('button', { name: 'Listo, ya la entregué' })),
    });

    // ── Acciones ──
    await d.say('Con los **tres puntos** de cada persona tienes más opciones.', {
      voice: 'Con los tres puntos de cada persona tienes más opciones.',
      during: () => d.tap(page.getByRole('button', { name: 'Acciones para Laura Gómez' })),
    });
    await d.say('Si olvidó la clave o el PIN, los **restableces** aquí.', {
      voice: 'Si olvidó la clave o el PIN, los restableces aquí.',
      focus: page.getByRole('menuitem', { name: 'Restablecer contraseña' }),
    });
    await d.say('Si alguien deja de trabajar, toca **Desactivar**: ya no podrá ingresar.', {
      voice: 'Si alguien deja de trabajar, toca desactivar: ya no podrá ingresar.',
      focus: page.getByRole('menuitem', { name: 'Desactivar' }),
    });
    await d.press('Escape');
    await d.say(
      'Si se equivoca 5 veces con la clave, la cuenta se bloquea y aquí la desbloqueas.',
      {
        voice:
          'Si se equivoca cinco veces con la clave, la cuenta se bloquea y aquí la desbloqueas.',
      },
    );
  },
});
