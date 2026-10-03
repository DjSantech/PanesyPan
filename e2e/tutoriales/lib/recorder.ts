import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CDPSession, Page } from '@playwright/test';

export interface Frame {
  file: string;
  /** Milisegundos desde que empezó la grabación. */
  time: number;
}

export interface Recording {
  frames: Frame[];
  /** Duración total en milisegundos. */
  duration: number;
}

/**
 * Graba la página con el screencast de Chromium: cada cuadro llega como JPEG con la hora en que
 * se pintó (solo llegan cuadros cuando algo cambia en pantalla). Se guardan en disco y al final
 * ffmpeg los convierte en un video de cuadros por segundo constantes.
 */
export class ScreenRecorder {
  private readonly frames: Frame[] = [];
  private readonly writes: Promise<void>[] = [];
  private stopped = false;

  private constructor(
    private readonly cdp: CDPSession,
    private readonly dir: string,
    private readonly startedAt: number,
  ) {}

  static async start(page: Page, dir: string): Promise<ScreenRecorder> {
    mkdirSync(dir, { recursive: true });
    const cdp = await page.context().newCDPSession(page);
    const recorder = new ScreenRecorder(cdp, dir, Date.now());
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      if (recorder.stopped) return;
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
      const paintedAt = metadata.timestamp === undefined ? Date.now() : metadata.timestamp * 1000;
      recorder.addFrame(data, paintedAt);
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 90,
      maxWidth: 1080,
      maxHeight: 1920,
      everyNthFrame: 1,
    });
    return recorder;
  }

  /** Milisegundos desde que empezó la grabación (mismo reloj que los cuadros). */
  now(): number {
    return Date.now() - this.startedAt;
  }

  async stop(): Promise<Recording> {
    const duration = this.now();
    await this.cdp.send('Page.stopScreencast').catch(() => undefined);
    this.stopped = true;
    await Promise.all(this.writes);
    await this.cdp.detach().catch(() => undefined);
    if (this.frames.length === 0) throw new Error('La grabación no tiene cuadros');
    return { frames: [...this.frames], duration };
  }

  private addFrame(base64: string, paintedAt: number): void {
    const file = path.join(this.dir, `cuadro-${String(this.frames.length).padStart(6, '0')}.jpg`);
    this.frames.push({ file, time: Math.max(0, paintedAt - this.startedAt) });
    this.writes.push(writeFile(file, Buffer.from(base64, 'base64')));
  }
}
