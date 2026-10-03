import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { readWav } from './wav';

export interface NarratorOptions {
  /** Parte del nombre de la voz de Windows (OneCore): "Sabina", "Raul"… */
  voice: string;
  /** Velocidad: 1 es la normal de Windows. */
  rate: number;
  cacheDir: string;
}

export interface Narration {
  file: string;
  durationMs: number;
}

/**
 * Proceso de PowerShell que convierte texto en voz con las voces de Windows (WinRT/OneCore).
 * Lee por stdin una línea por frase: "<id>\t<texto en base64 UTF-8>\t<archivo.wav>" y responde
 * "<id>\tok" o "<id>\terror\t<mensaje>". Se pasa con -EncodedCommand: así no depende de la
 * política de ejecución de scripts ni de la codificación de un archivo .ps1.
 */
function workerScript({ voice, rate }: Pick<NarratorOptions, 'voice' | 'rate'>): string {
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
} | Select-Object -First 1
function Wait-WinRT($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$selected = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices |
  Where-Object { $_.DisplayName -like '*${voice}*' } | Select-Object -First 1
if ($null -eq $selected) {
  [Console]::Out.WriteLine("fatal\`tLa voz '${voice}' no está instalada en Windows")
  exit 1
}
$synth.Voice = $selected
$synth.Options.SpeakingRate = ${String(rate)}
$synth.Options.AppendedSilence = [Windows.Media.SpeechSynthesis.SpeechAppendedSilence, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]::Min
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $parts = $line.Split("\`t")
  try {
    $text = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[1]))
    $stream = Wait-WinRT ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    $size = [uint32]$stream.Size
    Wait-WinRT ($reader.LoadAsync($size)) ([uint32]) | Out-Null
    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    [System.IO.File]::WriteAllBytes($parts[2], $bytes)
    $reader.Dispose()
    $stream.Dispose()
    [Console]::Out.WriteLine("$($parts[0])\`tok")
  } catch {
    [Console]::Out.WriteLine("$($parts[0])\`terror\`t$($_.Exception.Message)")
  }
  [Console]::Out.Flush()
}
`;
}

/**
 * Narrador de los videos: genera cada frase con la voz de Windows y la guarda en caché (por
 * voz, velocidad y texto), así volver a grabar un video no vuelve a sintetizar lo mismo.
 */
export class Narrator {
  private nextId = 1;
  private readonly waiting: ((line: string) => void)[] = [];

  private constructor(
    private readonly worker: ChildProcessWithoutNullStreams,
    private readonly options: NarratorOptions,
  ) {
    createInterface({ input: worker.stdout }).on('line', (line) => {
      this.waiting.shift()?.(line);
    });
  }

  static async start(options: NarratorOptions): Promise<Narrator> {
    if (process.platform !== 'win32') {
      throw new Error(
        'La voz de los videos usa las voces de Windows: genera los videos en Windows',
      );
    }
    mkdirSync(options.cacheDir, { recursive: true });
    const encoded = Buffer.from(workerScript(options), 'utf16le').toString('base64');
    const worker = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { stdio: 'pipe', windowsHide: true },
    );
    const narrator = new Narrator(worker, options);
    const first = await narrator.nextLine();
    if (first !== 'ready') {
      worker.kill();
      throw new Error(`No arrancó la voz de Windows: ${first.replace('fatal\t', '')}`);
    }
    return narrator;
  }

  /** Archivo de la frase si ya se había narrado antes. */
  cached(text: string): Narration | null {
    const file = this.cacheFile(text);
    return existsSync(file) ? { file, durationMs: readWav(file).durationMs } : null;
  }

  async speak(text: string): Promise<Narration> {
    const hit = this.cached(text);
    if (hit !== null) return hit;

    const file = this.cacheFile(text);
    const partial = `${file}.tmp`;
    const id = String(this.nextId++);
    const response = this.nextLine();
    this.worker.stdin.write(`${id}\t${Buffer.from(text, 'utf8').toString('base64')}\t${partial}\n`);
    const [answerId, status, message] = (await response).split('\t');
    if (answerId !== id || status !== 'ok') {
      throw new Error(`La voz falló con "${text}": ${message ?? status ?? 'sin respuesta'}`);
    }
    renameSync(partial, file);
    return { file, durationMs: readWav(file).durationMs };
  }

  async close(): Promise<void> {
    this.worker.stdin.end();
    await new Promise<void>((resolve) => {
      if (this.worker.exitCode !== null) resolve();
      else this.worker.once('exit', () => resolve());
    });
  }

  private cacheFile(text: string): string {
    const { voice, rate, cacheDir } = this.options;
    const hash = createHash('sha1')
      .update(`${voice}|${String(rate)}|${text}`)
      .digest('hex');
    return path.join(cacheDir, `${hash.slice(0, 16)}.wav`);
  }

  private nextLine(): Promise<string> {
    return new Promise((resolve, reject) => {
      const onExit = (code: number | null) => {
        reject(new Error(`La voz de Windows se cerró (código ${String(code)})`));
      };
      this.worker.once('exit', onExit);
      this.waiting.push((line) => {
        this.worker.off('exit', onExit);
        resolve(line);
      });
    });
  }
}
