import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Carpeta raíz del repositorio. */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Videos terminados. Van en .local/ (no se versiona): los MP4 pesan demasiado para git. */
export const OUTPUT_DIR = path.join(REPO_ROOT, '.local', 'videos');

/** Frases ya narradas: se reutilizan entre ejecuciones mientras el texto no cambie. */
export const VOICE_CACHE_DIR = path.join(OUTPUT_DIR, '.voz');

/** Cuadros temporales de cada grabación (se borran cuando el MP4 queda listo). */
export const FRAMES_DIR = path.join(os.tmpdir(), 'panesypan-videos');
