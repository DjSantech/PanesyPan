import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test, type Locator, type Page } from '@playwright/test';
import { Demo, type Role } from './demo';
import { Director, type OutroSpec } from './director';
import { PHONE, VOICE } from './format';
import { Narrator } from './narrator';
import { FRAMES_DIR, OUTPUT_DIR, VOICE_CACHE_DIR } from './paths';
import { ScreenRecorder } from './recorder';
import { renderVideo } from './render';
import { Studio } from './studio';

export interface TutorialSpec {
  /** Nombre del MP4 (sin extensión), p. ej. "03-vender-1". */
  file: string;
  /** Etiqueta de la portada, p. ej. "Vender · Parte 1 de 3". */
  part: string;
  title: string;
  /** Lo que dice la voz en la portada. */
  introVoice: string;
  /** Quién usa el sistema en el video (null: empieza sin sesión, en la pantalla de ingreso). */
  role: Role | null;
  /** Pantalla donde empieza y elemento que indica que ya cargó. */
  start: { path: string; ready: (page: Page) => Locator };
  /** Deja los datos como deben estar al empezar (no se graba). Lo que devuelve llega al guion. */
  prepare?: (demo: Demo) => Promise<Record<string, string> | undefined>;
  outro: OutroSpec;
  script: (director: Director) => Promise<void>;
}

/**
 * Registra un video como prueba de Playwright: prepara los datos, ensaya el guion para narrar
 * todas las frases antes de grabar, lo graba en el celular y deja el MP4 en .local/videos/.
 */
export function tutorial(spec: TutorialSpec): void {
  test(`${spec.file} · ${spec.title}`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    const demo = await Demo.connect(browser);
    const context = await browser.newContext(PHONE);
    // Si un paso no encuentra su botón, falla rápido en vez de esperar todo el video.
    context.setDefaultTimeout(15_000);
    const narrator = await Narrator.start({ ...VOICE, cacheDir: VOICE_CACHE_DIR });
    try {
      const data = (await spec.prepare?.(demo)) ?? {};
      if (spec.role !== null) await demo.signIn(context, spec.role);
      const page = await context.newPage();
      const studio = await Studio.install(page);
      await page.goto(spec.start.path);
      await spec.start.ready(page).waitFor();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      const rehearsal = new Director(page, data, studio, narrator, null);
      await rehearsal.intro(spec);
      await spec.script(rehearsal);
      await rehearsal.outro(spec.outro);
      for (const line of rehearsal.lines) await narrator.speak(line);

      const workDir = path.join(FRAMES_DIR, spec.file);
      rmSync(workDir, { recursive: true, force: true });
      await studio.cover();
      await page.waitForTimeout(300);
      const recorder = await ScreenRecorder.start(page, workDir);
      const director = new Director(page, data, studio, narrator, recorder);
      await director.intro(spec);
      await spec.script(director);
      await director.outro(spec.outro);
      const recording = await recorder.stop();

      mkdirSync(OUTPUT_DIR, { recursive: true });
      const output = path.join(OUTPUT_DIR, `${spec.file}.mp4`);
      await renderVideo({ recording, cues: director.cues, output, workDir });
      rmSync(workDir, { recursive: true, force: true });
      const seconds = Math.round(recording.duration / 1000);
      process.stdout.write(`  🎬 ${output} (${String(seconds)} s)\n`);
    } finally {
      await narrator.close();
      await context.close();
      await demo.close();
    }
  });
}
