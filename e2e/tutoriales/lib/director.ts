import type { Locator, Page } from '@playwright/test';
import { SYSTEM_URL } from './format';
import type { Narrator } from './narrator';
import type { ScreenRecorder } from './recorder';
import type { AudioCue } from './render';
import {
  captionToHtml,
  captionToSpeech,
  type Box,
  type CaptionPosition,
  type Studio,
} from './studio';

export interface SayOptions {
  /** Lo que dice la voz cuando debe sonar distinto al subtítulo (números, signos…). */
  voice?: string;
  /** Elemento que se resalta mientras se dice la frase. */
  focus?: Locator;
  /** Oscurece el resto de la pantalla alrededor del resaltado. */
  dim?: boolean;
  position?: CaptionPosition;
  /** Acciones que pasan mientras suena la frase. */
  during?: () => Promise<void>;
  /** Silencio después de la frase, en milisegundos. */
  pause?: number;
}

export interface IntroSpec {
  part: string;
  title: string;
  introVoice: string;
}

export interface OutroSpec {
  text: string;
  next?: string;
  voice: string;
}

/** Lo que tarda en irse un subtítulo antes de mostrar el siguiente (ver setCaption en studio). */
const CAPTION_SWAP_MS = 200;

/**
 * Dirige la grabación como lo haría una persona: dice cada paso (subtítulo + voz), mueve el
 * dedo hasta el botón, lo toca y espera. Sin grabadora es un ensayo: solo junta las frases
 * para narrarlas antes de grabar y no toca la página.
 */
export class Director {
  readonly cues: AudioCue[] = [];
  /** Frases que dice la voz (las junta el ensayo). */
  readonly lines: string[] = [];
  /** Dónde quedó el dedo después del último toque. */
  private touchAt: { x: number; y: number } | null = null;
  private captionShown = false;

  constructor(
    readonly page: Page,
    /** Datos que dejó listos la preparación (p. ej. una contraseña temporal). */
    readonly data: Readonly<Record<string, string>>,
    private readonly studio: Studio,
    private readonly narrator: Narrator,
    private readonly recorder: ScreenRecorder | null,
  ) {}

  async intro({ part, title, introVoice }: IntroSpec): Promise<void> {
    if (this.recorder === null) {
      this.lines.push(introVoice);
      return;
    }
    await this.studio.card({
      kind: 'intro',
      kicker: 'Cómo usar el sistema',
      part,
      title,
      url: SYSTEM_URL,
    });
    await this.page.waitForTimeout(1_000);
    await this.narrate(introVoice);
    await this.page.waitForTimeout(500);
    await this.studio.hideCard();
    await this.page.waitForTimeout(800);
  }

  async outro({ text, next, voice }: OutroSpec): Promise<void> {
    if (this.recorder === null) {
      this.lines.push(voice);
      return;
    }
    await this.studio.caption(null, 'top');
    this.captionShown = false;
    await this.studio.highlight(null);
    await this.studio.hideTouch();
    await this.page.waitForTimeout(400);
    await this.studio.card({
      kind: 'outro',
      title: '¡Listo!',
      text,
      ...(next === undefined ? {} : { next }),
      url: SYSTEM_URL,
    });
    await this.page.waitForTimeout(900);
    await this.narrate(voice);
    await this.page.waitForTimeout(1_800);
  }

  /** Muestra el subtítulo, lo narra y espera a que termine la voz. */
  async say(caption: string, options: SayOptions = {}): Promise<void> {
    const speech = options.voice ?? captionToSpeech(caption);
    if (this.recorder === null) {
      this.lines.push(speech);
      return;
    }
    let focusBox: Box | null = null;
    if (options.focus === undefined) {
      await this.studio.highlight(null);
    } else {
      focusBox = await this.reveal(options.focus);
      await this.studio.highlight(pad(focusBox, 6), options.dim ?? false);
    }
    const narration = await this.narrator.speak(speech);
    const replacing = this.captionShown;
    await this.studio.caption(captionToHtml(caption), options.position ?? 'top', focusBox);
    this.captionShown = true;
    // Si había otro subtítulo, el nuevo aparece cuando el anterior termina de irse: la voz
    // arranca en ese momento.
    if (replacing) await this.page.waitForTimeout(CAPTION_SWAP_MS);
    this.cues.push({ kind: 'voice', time: this.recorder.now(), file: narration.file });
    const started = Date.now();
    if (options.during !== undefined) await options.during();
    const left = narration.durationMs - (Date.now() - started);
    await this.page.waitForTimeout(Math.max(0, left) + (options.pause ?? 400));
  }

  /** Lleva el dedo hasta el elemento y lo toca. */
  async tap(target: Locator): Promise<void> {
    const recorder = this.recorder;
    if (recorder === null) return;
    await this.studio.highlight(null);
    const box = await this.reveal(target);
    await this.studio.avoid(box);
    await this.moveTouch(box.x + box.width / 2, box.y + box.height / 2);
    await this.studio.tap();
    this.cues.push({ kind: 'tap', time: recorder.now() });
    await target.click();
    await this.page.waitForTimeout(300);
  }

  /** Toca el campo y escribe como una persona. */
  async type(target: Locator, text: string): Promise<void> {
    if (this.recorder === null) return;
    await this.tap(target);
    // Algunos campos traen texto (sugerido o guardado): se borra antes de escribir.
    await target.fill('');
    await target.pressSequentially(text, { delay: 110 });
    await this.page.waitForTimeout(250);
  }

  /** Toca la lista desplegable y elige una opción (por su texto). */
  async select(target: Locator, label: string): Promise<void> {
    if (this.recorder === null) return;
    await this.tap(target);
    await target.selectOption({ label });
    await this.page.waitForTimeout(350);
  }

  /** Marca un PIN en el teclado numérico de la pantalla. */
  async pin(digits: string, scope: Locator | Page = this.page): Promise<void> {
    for (const digit of digits) {
      await this.tap(scope.getByRole('button', { name: `Dígito ${digit}` }));
    }
  }

  /** Desplaza la pantalla con suavidad hasta dejar el elemento en el centro. */
  async scrollTo(target: Locator): Promise<void> {
    if (this.recorder === null) return;
    await target.waitFor({ state: 'visible', timeout: 15_000 });
    const box = await target.boundingBox();
    if (box === null) return;
    await target.evaluate((element) => {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    await this.settledBox(target, box);
  }

  async highlight(target: Locator | null, dim = false): Promise<void> {
    if (this.recorder === null) return;
    if (target === null) {
      await this.studio.highlight(null);
      return;
    }
    const box = await this.reveal(target);
    await this.studio.avoid(box);
    await this.studio.highlight(pad(box, 6), dim);
  }

  /** Presiona una tecla (p. ej. Escape para cerrar un menú). */
  async press(key: string): Promise<void> {
    if (this.recorder === null) return;
    await this.page.keyboard.press(key);
    await this.page.waitForTimeout(350);
  }

  async wait(ms: number): Promise<void> {
    if (this.recorder === null) return;
    await this.page.waitForTimeout(ms);
  }

  /** Espera a que el sistema muestre el tiquete (al tocar "Imprimir tiquete"). */
  async waitForTicket(): Promise<void> {
    if (this.recorder === null) return;
    await this.page.waitForFunction(() => window.__studio.printShown());
  }

  async closeTicket(): Promise<void> {
    if (this.recorder === null) return;
    await this.studio.closePrint();
    await this.page.waitForTimeout(400);
  }

  private async narrate(text: string): Promise<void> {
    if (this.recorder === null) return;
    const narration = await this.narrator.speak(text);
    this.cues.push({ kind: 'voice', time: this.recorder.now(), file: narration.file });
    await this.page.waitForTimeout(narration.durationMs);
  }

  private async moveTouch(x: number, y: number): Promise<void> {
    const from = this.touchAt ?? { x, y: y + 60 };
    const distance = Math.hypot(x - from.x, y - from.y);
    const ms = Math.round(Math.min(800, Math.max(380, 260 + distance * 0.9)));
    const duration = await this.studio.touch(x, y, ms);
    this.touchAt = { x, y };
    await this.page.waitForTimeout(duration + 60);
  }

  /** Espera a que el elemento se vea y, si queda tapado o fuera de pantalla, lo desplaza. */
  private async reveal(target: Locator): Promise<Box> {
    await target.waitFor({ state: 'visible', timeout: 15_000 });
    const box = await target.boundingBox();
    if (box === null) throw new Error('El elemento no está en pantalla');
    // Se ve si está dentro de la pantalla y nada lo tapa (encabezado, barras fijas de abajo):
    // arriba, en el centro y abajo, el elemento que recibe el toque es él mismo.
    const inView = await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) return false;
      const x = rect.left + rect.width / 2;
      return [rect.top + 4, rect.top + rect.height / 2, rect.bottom - 4].every((y) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && element.contains(hit);
      });
    });
    if (inView) return box;
    await target.evaluate((element) => {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return this.settledBox(target, box);
  }

  private async settledBox(target: Locator, initial: Box): Promise<Box> {
    let previous = initial;
    for (let attempt = 0; attempt < 25; attempt++) {
      await this.page.waitForTimeout(90);
      const box = await target.boundingBox();
      if (box === null) continue;
      if (Math.abs(box.y - previous.y) < 0.5 && Math.abs(box.x - previous.x) < 0.5) return box;
      previous = box;
    }
    return previous;
  }
}

function pad(box: Box, amount: number): Box {
  return {
    x: box.x - amount,
    y: box.y - amount,
    width: box.width + amount * 2,
    height: box.height + amount * 2,
  };
}
