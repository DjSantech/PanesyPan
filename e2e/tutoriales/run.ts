/**
 * Graba los videos uno por uno, cada uno con su propio entorno recién creado (base de datos
 * en memoria nueva): así cada video empieza siempre igual, sin importar cuáles se grabaron
 * antes. Uso: `pnpm videos` (todos) o `pnpm videos vender inicio` (los que coincidan).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2).map((filter) => filter.toLowerCase());
const files = readdirSync(path.join(here, 'videos'))
  .filter((file) => file.endsWith('.video.ts'))
  .filter((file) => filters.length === 0 || filters.some((filter) => file.includes(filter)))
  .sort();

if (files.length === 0) {
  console.error(`No hay videos que coincidan con: ${filters.join(', ')}`);
  process.exit(1);
}

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const failed: string[] = [];
for (const [index, file] of files.entries()) {
  process.stdout.write(`\n▶ ${String(index + 1)}/${String(files.length)} ${file}\n`);
  const result = spawnSync(
    process.execPath,
    [cli, 'test', '-c', path.join(here, 'playwright.config.ts'), `videos/${file}`],
    { cwd: path.dirname(here), stdio: 'inherit' },
  );
  if (result.status !== 0) failed.push(file);
}

if (failed.length > 0) {
  console.error(`\nFallaron: ${failed.join(', ')}`);
  process.exit(1);
}
process.stdout.write(`\nListo: ${String(files.length)} video(s) en .local/videos/\n`);
