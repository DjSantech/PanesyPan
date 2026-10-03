import { tutorial } from '../lib/tutorial';

const NEW_PASSWORD = 'pan-caliente-mañanero';
const NEW_PIN = '246810';

tutorial({
  file: '01-ingresar',
  part: 'Primeros pasos',
  title: 'Cómo ingresar al sistema',
  introVoice: 'Primeros pasos. Cómo ingresar al sistema.',
  role: null,
  start: {
    path: '/ingresar',
    ready: (page) => page.getByRole('button', { name: 'Ingresar' }),
  },
  async prepare(demo) {
    return { password: await demo.createUser('Andrea López', 'andrea') };
  },
  outro: {
    text: 'Ya sabes ingresar, bloquear la pantalla y cambiar tu clave o tu PIN.',
    next: 'Inicio: el resumen del día',
    voice:
      'Listo. Ya sabes ingresar, bloquear la pantalla y cambiar tu clave o tu PIN. En el siguiente video: el inicio, con el resumen del día.',
  },

  async script(d) {
    const { page } = d;

    // ── Primer ingreso ──
    await d.say('Cada persona tiene **su propio usuario**. No se comparte.', {
      focus: page.locator('form'),
    });
    await d.say(
      'La primera vez escribes tu usuario y la **clave temporal** que te da el administrador.',
      {
        voice: 'La primera vez escribes tu usuario y la clave temporal que te da el administrador.',
        during: async () => {
          await d.type(page.getByLabel('Usuario o correo'), 'andrea');
          await d.type(page.getByLabel('Contraseña', { exact: true }), d.data.password ?? '');
        },
      },
    );
    await d.say('Toca **Ingresar**.', {
      during: () => d.tap(page.getByRole('button', { name: 'Ingresar' })),
    });

    // ── Nueva contraseña ──
    await d.say('El sistema te pide crear **tu propia contraseña**, de al menos 8 caracteres.', {
      voice: 'El sistema te pide crear tu propia contraseña, de al menos ocho caracteres.',
      focus: page.getByRole('heading', { name: 'Nueva contraseña' }),
    });
    await d.say('Escribe la temporal y después la nueva, dos veces.', {
      during: async () => {
        await d.type(page.getByLabel('Contraseña temporal'), d.data.password ?? '');
        await d.type(page.getByLabel('Nueva contraseña', { exact: true }), NEW_PASSWORD);
        await d.type(page.getByLabel('Repite la nueva contraseña'), NEW_PASSWORD);
      },
    });
    await d.say('Toca **Guardar y continuar**.', {
      during: () => d.tap(page.getByRole('button', { name: 'Guardar y continuar' })),
    });

    // ── PIN ──
    await d.say('Ahora crea tu **PIN**: seis números fáciles de recordar para ti.', {
      voice: 'Ahora crea tu PIN: seis números fáciles de recordar para ti.',
      focus: page.getByRole('heading', { name: 'Crea tu PIN' }),
    });
    await d.say('Márcalo en el teclado…', {
      voice: 'Márcalo en el teclado.',
      during: () => d.pin(NEW_PIN),
    });
    await d.say('…y repítelo para confirmarlo.', {
      voice: 'Y repítelo para confirmarlo.',
      during: () => d.pin(NEW_PIN),
    });
    await d.say('¡Listo! Ya estás dentro del sistema.', {
      voice: 'Listo. Ya estás dentro del sistema.',
    });

    // ── Bloqueo ──
    await d.say('Si dejas la pantalla sola **10 minutos**, se bloquea sola.', {
      voice: 'Si dejas la pantalla sola diez minutos, se bloquea sola.',
    });
    await d.say('También la puedes bloquear con el **candado** si te alejas.', {
      voice: 'También la puedes bloquear con el candado si te alejas.',
      during: () => d.tap(page.getByRole('button', { name: 'Bloquear pantalla' })),
    });
    await d.say('Para seguir, escribe tu PIN. Nadie más puede usar tu sesión.', {
      focus: page.getByRole('heading', { name: 'Pantalla bloqueada' }),
    });
    await d.pin(NEW_PIN);
    await d.wait(800);

    // ── Mi cuenta ──
    await d.say('En tu menú, arriba a la derecha, está **Mi cuenta**.', {
      voice: 'En tu menú, arriba a la derecha, está mi cuenta.',
      during: async () => {
        await d.tap(page.getByRole('button', { name: 'Menú de Andrea López' }));
        await d.tap(page.getByRole('menuitem', { name: 'Mi cuenta' }));
      },
    });
    await d.say('Aquí cambias tu **contraseña** cuando quieras…', {
      voice: 'Aquí cambias tu contraseña cuando quieras.',
      focus: page.getByLabel('Contraseña actual').first(),
    });
    await d.scrollTo(page.getByLabel('Nuevo PIN (6 números)'));
    await d.say('…y también tu **PIN**.', {
      voice: 'Y también tu PIN.',
      focus: page.getByLabel('Nuevo PIN (6 números)'),
    });

    // ── Cerrar sesión ──
    await d.say('Al terminar el turno, abre tu menú y toca **Cerrar sesión**.', {
      voice: 'Al terminar el turno, abre tu menú y toca cerrar sesión.',
      during: async () => {
        await d.tap(page.getByRole('button', { name: 'Menú de Andrea López' }));
        await d.highlight(page.getByRole('menuitem', { name: 'Cerrar sesión', exact: true }));
        await d.wait(900);
        await d.tap(page.getByRole('menuitem', { name: 'Cerrar sesión', exact: true }));
      },
    });
    await d.say('Si olvidas la clave o el PIN, el administrador te los restablece.');
  },
});
