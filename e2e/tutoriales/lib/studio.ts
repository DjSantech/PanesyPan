import type { Page } from '@playwright/test';

export type CaptionPosition = 'top' | 'bottom';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CardContent {
  kind: 'intro' | 'outro';
  title: string;
  kicker?: string;
  part?: string;
  text?: string;
  next?: string;
  url: string;
}

interface StudioApi {
  cover: () => void;
  card: (content: CardContent) => void;
  hideCard: () => void;
  caption: (html: string | null, position: CaptionPosition, avoid: Box | null) => void;
  avoid: (box: Box) => void;
  /** Mueve el dedo y devuelve cuánto dura el movimiento (ms). */
  touch: (x: number, y: number, ms: number) => number;
  tap: () => void;
  hideTouch: () => void;
  highlight: (box: Box | null, dim: boolean) => void;
  printShown: () => boolean;
  closePrint: () => void;
}

declare global {
  interface Window {
    __studio: StudioApi;
  }
}

/**
 * Capa de presentación que se monta dentro de la página en cada carga (Playwright serializa
 * esta función: no puede usar nada de fuera). Va en un shadow DOM encima de todo y sin recibir
 * toques, así no cambia el comportamiento del sistema. También reemplaza window.print para
 * mostrar el tiquete en pantalla en vez de abrir el diálogo de impresión.
 */
function installStudio(): void {
  if (Reflect.has(window, '__studio')) return;

  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer { position: fixed; inset: 0; overflow: hidden; pointer-events: none;
      font-family: 'Nunito Sans Variable', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    .hl { position: absolute; border-radius: 16px; border: 3px solid #E0B25C; opacity: 0;
      box-shadow: 0 0 0 4px rgba(224, 178, 92, .35);
      transition: opacity .25s ease, left .3s ease, top .3s ease, width .3s ease, height .3s ease; }
    .hl.instant { transition: opacity .25s ease; }
    .hl.on { opacity: 1; }
    .hl.dim { box-shadow: 0 0 0 4px rgba(224, 178, 92, .35), 0 0 0 200vmax rgba(33, 17, 10, .42); }
    .hl.on::after { content: ''; position: absolute; inset: -9px; border-radius: 22px;
      border: 2px solid rgba(224, 178, 92, .75); animation: pulse 1.3s ease-out infinite; }
    @keyframes pulse { from { opacity: .9; transform: scale(.97); } to { opacity: 0; transform: scale(1.07); } }
    .caption { position: absolute; left: 14px; right: 14px; display: flex; gap: 11px;
      padding: 13px 16px 14px 13px; border-radius: 18px; background: rgba(43, 23, 14, .93); color: #FFF7EE;
      box-shadow: 0 12px 32px rgba(0, 0, 0, .28); opacity: 0; transform: translateY(var(--from));
      transition: opacity .2s ease, transform .2s ease, top .25s ease; }
    .caption[data-pos='top'] { top: var(--top, 14px); --from: -8px; }
    .caption[data-pos='bottom'] { bottom: 158px; --from: 8px; }
    .caption.on { opacity: 1; transform: none; }
    .caption .bar { flex: none; width: 4px; border-radius: 4px; background: #E0B25C; }
    .caption p { margin: 0; font-size: 19px; line-height: 1.32; font-weight: 750; }
    .caption b { color: #F3C76E; font-weight: 850; }
    .touch { position: absolute; left: 0; top: 0; width: 42px; height: 42px; margin: -21px 0 0 -21px;
      opacity: 0; transition-property: transform, opacity;
      transition-timing-function: cubic-bezier(.45, .05, .25, 1), ease; transition-duration: 600ms, .2s; }
    .touch.on { opacity: 1; }
    .touch .dot { width: 100%; height: 100%; border-radius: 50%; background: rgba(255, 255, 255, .62);
      border: 2.5px solid rgba(43, 23, 14, .55); box-shadow: 0 3px 10px rgba(0, 0, 0, .3);
      transition: transform .12s ease, background .12s ease; }
    .touch.press .dot { transform: scale(.78); background: rgba(224, 178, 92, .8); }
    .ripple { position: absolute; width: 42px; height: 42px; margin: -21px 0 0 -21px; border-radius: 50%;
      border: 3px solid #E0B25C; animation: ripple .55s ease-out forwards; }
    @keyframes ripple { from { transform: scale(.5); opacity: 1; } to { transform: scale(2.3); opacity: 0; } }
    .card { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center;
      justify-content: center; gap: 14px; padding: 40px 34px 90px; text-align: center; color: #3B2418;
      background: radial-gradient(120% 80% at 50% 28%, #FFF8EE 0%, #F7ECDF 55%, #EBD9C2 100%); }
    .card.on { display: flex; }
    .card.in { animation: card-in .7s cubic-bezier(.7, 0, .3, 1) both; }
    .card.out { animation: card-in .7s cubic-bezier(.7, 0, .3, 1) reverse forwards; }
    .card.in, .card.out { box-shadow: 0 12px 40px rgba(0, 0, 0, .3); }
    @keyframes card-in { from { transform: translateY(-100%); } }
    .card > * { margin: 0; animation: rise .7s cubic-bezier(.2, .7, .2, 1) both;
      animation-delay: calc(var(--i) * 130ms + 150ms); }
    @keyframes rise { from { opacity: 0; transform: translateY(18px); } }
    .logo { width: 132px; height: 132px; border-radius: 50%;
      box-shadow: 0 0 0 6px #FFFFFF, 0 14px 34px rgba(161, 69, 46, .28); }
    .kicker { margin-top: 12px; font-size: 14px; font-weight: 850; letter-spacing: .14em;
      text-transform: uppercase; color: #A1452E; }
    .part { padding: 7px 16px; border-radius: 999px; background: #A1452E; color: #FFF7EE;
      font-size: 15px; font-weight: 800; }
    .title { font-family: 'Playfair Display Variable', Georgia, serif; font-size: 36px; line-height: 1.14;
      font-weight: 700; text-wrap: balance; }
    .rule { width: 56px; height: 3px; border-radius: 3px; background: #E0B25C; }
    .text { max-width: 320px; font-size: 19px; line-height: 1.4; font-weight: 650; color: #5C3A2A;
      text-wrap: balance; }
    .next { margin-top: 10px; padding: 14px 18px; border-radius: 18px; background: rgba(161, 69, 46, .1);
      border: 1.5px solid rgba(161, 69, 46, .25); font-size: 16px; line-height: 1.35; font-weight: 750;
      color: #6B3424; text-wrap: balance; }
    .next small { display: block; margin-bottom: 4px; font-size: 12px; font-weight: 850;
      letter-spacing: .12em; text-transform: uppercase; color: #A1452E; }
    .url { position: absolute; bottom: 36px; font-size: 15px; font-weight: 800; color: #8A6450; }
  `;

  const globalCss = `
    .print-area.studio-print { display: block !important; position: fixed; left: 50%; top: 47%;
      z-index: 2147483000; width: max-content; max-width: 92vw; padding: 12px 10px 20px; background: #FFFFFF;
      color: #000000; border-radius: 4px; box-shadow: 0 24px 60px rgba(0, 0, 0, .45);
      animation: studio-ticket .55s cubic-bezier(.2, .7, .2, 1) both; }
    @keyframes studio-ticket {
      from { opacity: 0; transform: translate(-50%, -62%) scale(var(--studio-scale, 1)); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(var(--studio-scale, 1)); } }
    .studio-print-backdrop { position: fixed; inset: 0; z-index: 2147482999; background: rgba(20, 10, 6, .55);
      animation: studio-fade .3s ease both; }
    @keyframes studio-fade { from { opacity: 0; } }
  `;

  let shadow: ShadowRoot | null = null;
  const ui = (): ShadowRoot => {
    if (shadow?.host.isConnected === true) return shadow;
    const style = document.createElement('style');
    style.textContent = globalCss;
    document.documentElement.append(style);
    const host = document.createElement('studio-overlay');
    host.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;';
    document.documentElement.append(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      `<style>${css}</style><div class="layer"><div class="hl"></div>` +
      '<div class="caption" data-pos="top"><span class="bar"></span><p></p></div>' +
      '<div class="touch"><div class="dot"></div></div><div class="card"></div></div>';
    return shadow;
  };
  const el = (selector: string): HTMLElement => {
    const found = ui().querySelector<HTMLElement>(selector);
    if (found === null) throw new Error(`studio: falta ${selector}`);
    return found;
  };
  const overlaps = (a: DOMRect, b: Box): boolean =>
    a.left < b.x + b.width + 8 &&
    a.right > b.x - 8 &&
    a.top < b.y + b.height + 8 &&
    a.bottom > b.y - 8;

  // ── Subtítulos ──
  let captionToken = 0;
  let captionHtml = '';
  let captionPosition: CaptionPosition = 'top';
  const showCaption = (html: string, preferred: CaptionPosition, avoid: Box | null): void => {
    const caption = el('.caption');
    el('.caption p').innerHTML = html;
    let position = preferred;
    if (avoid !== null) {
      caption.dataset.pos = preferred;
      if (overlaps(caption.getBoundingClientRect(), avoid)) {
        position = preferred === 'top' ? 'bottom' : 'top';
      }
    }
    caption.dataset.pos = position;
    captionHtml = html;
    captionPosition = position;
    caption.getBoundingClientRect();
    caption.classList.add('on');
  };
  const setCaption = (html: string | null, position: CaptionPosition, avoid: Box | null): void => {
    const token = ++captionToken;
    const caption = el('.caption');
    if (html === null) {
      caption.classList.remove('on');
      return;
    }
    if (!caption.classList.contains('on')) {
      showCaption(html, position, avoid);
      return;
    }
    caption.classList.remove('on');
    window.setTimeout(() => {
      if (token === captionToken) showCaption(html, position, avoid);
    }, 200);
  };

  // Los avisos del sistema salen arriba: el subtítulo baja mientras haya uno visible.
  window.setInterval(() => {
    if (shadow === null) return;
    let bottom = 0;
    document.querySelectorAll('[data-sonner-toast]').forEach((toast) => {
      const rect = toast.getBoundingClientRect();
      if (rect.height > 0 && rect.top < 220) bottom = Math.max(bottom, rect.bottom);
    });
    el('.caption').style.setProperty(
      '--top',
      bottom > 0 ? `${String(Math.round(bottom + 10))}px` : '14px',
    );
  }, 100);

  // ── Toques ──
  let touchX = 0;
  let touchY = 0;
  let touchHideTimer = 0;

  // ── Tiquete ──
  let printOpen = false;
  window.print = () => {
    const areas = document.querySelectorAll<HTMLElement>('.print-area');
    const area = areas[areas.length - 1];
    if (area === undefined) return;
    ui();
    const backdrop = document.createElement('div');
    backdrop.className = 'studio-print-backdrop';
    document.body.append(backdrop);
    area.classList.add('studio-print');
    const scale = Math.min(1, (window.innerHeight * 0.8) / Math.max(1, area.scrollHeight));
    area.style.setProperty('--studio-scale', String(scale));
    printOpen = true;
  };

  window.__studio = {
    cover: () => {
      const card = el('.card');
      card.className = 'card on';
      card.replaceChildren();
    },
    card: (content) => {
      const card = el('.card');
      // La portada ya cubre la pantalla al empezar; el cierre baja como un telón.
      card.className = content.kind === 'outro' ? 'card on in' : 'card on';
      card.replaceChildren();
      const add = (tag: string, className: string, text?: string): HTMLElement => {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) node.textContent = text;
        node.style.setProperty('--i', String(card.children.length));
        card.append(node);
        return node;
      };
      const logo = add('img', 'logo') as HTMLImageElement;
      logo.src = '/logo-panesypan-320.webp';
      logo.alt = '';
      if (content.kicker !== undefined) add('p', 'kicker', content.kicker);
      if (content.part !== undefined) add('p', 'part', content.part);
      add('h1', 'title', content.title);
      add('div', 'rule');
      if (content.text !== undefined) add('p', 'text', content.text);
      if (content.next !== undefined) {
        const next = add('p', 'next');
        const label = document.createElement('small');
        label.textContent = 'Siguiente video';
        next.append(label, content.next);
      }
      add('p', 'url', content.url);
    },
    hideCard: () => {
      const card = el('.card');
      card.className = 'card on out';
      window.setTimeout(() => {
        card.className = 'card';
        card.replaceChildren();
      }, 750);
    },
    caption: setCaption,
    avoid: (box) => {
      const caption = el('.caption');
      if (!caption.classList.contains('on')) return;
      if (!overlaps(caption.getBoundingClientRect(), box)) return;
      setCaption(captionHtml, captionPosition === 'top' ? 'bottom' : 'top', null);
    },
    touch: (x, y, ms) => {
      const touch = el('.touch');
      window.clearTimeout(touchHideTimer);
      let duration = ms;
      // Si el dedo estaba escondido, aparece un poco más abajo y sube hasta el botón.
      if (!touch.classList.contains('on')) {
        touch.style.transitionDuration = '0ms, .2s';
        touch.style.transform = `translate(${String(x)}px, ${String(y + 60)}px)`;
        touch.getBoundingClientRect();
        touch.classList.add('on');
        duration = 420;
      }
      touch.style.transitionDuration = `${String(duration)}ms, .2s`;
      touch.style.transform = `translate(${String(x)}px, ${String(y)}px)`;
      touchX = x;
      touchY = y;
      return duration;
    },
    tap: () => {
      const touch = el('.touch');
      touch.classList.add('press');
      window.setTimeout(() => {
        touch.classList.remove('press');
      }, 170);
      const ripple = document.createElement('div');
      ripple.className = 'ripple';
      ripple.style.left = `${String(touchX)}px`;
      ripple.style.top = `${String(touchY)}px`;
      el('.layer').append(ripple);
      window.setTimeout(() => {
        ripple.remove();
      }, 700);
      // Sin más toques seguidos, el dedo se esconde para no tapar la pantalla.
      window.clearTimeout(touchHideTimer);
      touchHideTimer = window.setTimeout(() => {
        touch.classList.remove('on');
      }, 1_400);
    },
    hideTouch: () => {
      el('.touch').classList.remove('on');
    },
    highlight: (box, dim) => {
      const ring = el('.hl');
      if (box === null) {
        ring.classList.remove('on', 'dim');
        return;
      }
      ring.classList.toggle('instant', !ring.classList.contains('on'));
      ring.style.left = `${String(box.x)}px`;
      ring.style.top = `${String(box.y)}px`;
      ring.style.width = `${String(box.width)}px`;
      ring.style.height = `${String(box.height)}px`;
      ring.classList.toggle('dim', dim);
      ring.getBoundingClientRect();
      ring.classList.add('on');
    },
    printShown: () => printOpen,
    closePrint: () => {
      document.querySelectorAll('.studio-print-backdrop').forEach((node) => {
        node.remove();
      });
      document.querySelectorAll('.studio-print').forEach((node) => {
        node.classList.remove('studio-print');
      });
      printOpen = false;
      window.dispatchEvent(new Event('afterprint'));
    },
  };
}

/** "Toca **Cobrar**" → HTML seguro con las palabras clave resaltadas. */
export function captionToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

/** El subtítulo sin marcas: es lo que dice la voz si no se indica otra cosa. */
export function captionToSpeech(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1');
}

/** Control de la capa de presentación desde la prueba. */
export class Studio {
  private constructor(private readonly page: Page) {}

  static async install(page: Page): Promise<Studio> {
    await page.addInitScript(installStudio);
    return new Studio(page);
  }

  cover(): Promise<void> {
    return this.page.evaluate(() => {
      window.__studio.cover();
    });
  }

  card(content: CardContent): Promise<void> {
    return this.page.evaluate((value) => {
      window.__studio.card(value);
    }, content);
  }

  hideCard(): Promise<void> {
    return this.page.evaluate(() => {
      window.__studio.hideCard();
    });
  }

  caption(html: string | null, position: CaptionPosition, avoid: Box | null = null): Promise<void> {
    return this.page.evaluate(
      ([value, where, box]) => {
        window.__studio.caption(value, where, box);
      },
      [html, position, avoid] as const,
    );
  }

  avoid(box: Box): Promise<void> {
    return this.page.evaluate((value) => {
      window.__studio.avoid(value);
    }, box);
  }

  /** Mueve el dedo; devuelve cuánto dura el movimiento (ms). */
  touch(x: number, y: number, ms: number): Promise<number> {
    return this.page.evaluate(
      ([left, top, duration]) => window.__studio.touch(left, top, duration),
      [x, y, ms] as const,
    );
  }

  tap(): Promise<void> {
    return this.page.evaluate(() => {
      window.__studio.tap();
    });
  }

  hideTouch(): Promise<void> {
    return this.page.evaluate(() => {
      window.__studio.hideTouch();
    });
  }

  highlight(box: Box | null, dim = false): Promise<void> {
    return this.page.evaluate(
      ([value, darken]) => {
        window.__studio.highlight(value, darken);
      },
      [box, dim] as const,
    );
  }

  printShown(): Promise<boolean> {
    return this.page.evaluate(() => window.__studio.printShown());
  }

  closePrint(): Promise<void> {
    return this.page.evaluate(() => {
      window.__studio.closePrint();
    });
  }
}
