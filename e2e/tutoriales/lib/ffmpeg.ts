import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

/**
 * Ruta de ffmpeg (paquete ffmpeg-static). El programa no se descarga al instalar dependencias
 * (ver allowBuilds en pnpm-workspace.yaml): se descarga aquí la primera vez que se necesita.
 */
export function ffmpegPath(): string {
  if (ffmpegStatic === null) throw new Error('ffmpeg-static no tiene ffmpeg para este sistema');
  if (!existsSync(ffmpegStatic)) {
    console.warn('[videos] Descargando ffmpeg (solo la primera vez)…');
    const install = spawnSync(process.execPath, ['install.js'], {
      cwd: path.dirname(ffmpegStatic),
      stdio: 'inherit',
    });
    if (install.status !== 0 || !existsSync(ffmpegStatic)) {
      throw new Error('No se pudo descargar ffmpeg (revisa la conexión a internet)');
    }
  }
  return ffmpegStatic;
}

/** Ejecuta ffmpeg y falla con sus últimas líneas de error si algo sale mal. */
export function runFfmpeg(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      cwd,
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg terminó con código ${String(code)}:\n${stderr}`));
    });
  });
}
