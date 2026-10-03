import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { runFfmpeg } from './ffmpeg';
import { FPS, VIDEO_SIZE } from './format';
import type { Recording } from './recorder';
import { readWav, writeWav, type WavData } from './wav';

export type AudioCue =
  { kind: 'voice'; time: number; file: string } | { kind: 'tap'; time: number };

/** La voz de Windows sale a 16 kHz: se mezcla a esa frecuencia y ffmpeg la lleva a 48 kHz. */
const MIX_RATE = 16_000;

export interface RenderInput {
  recording: Recording;
  cues: AudioCue[];
  output: string;
  /** Carpeta de los cuadros: ahí quedan también los archivos intermedios. */
  workDir: string;
}

/** Convierte los cuadros grabados y la narración en un MP4 (H.264 + AAC) listo para WhatsApp. */
export async function renderVideo({
  recording,
  cues,
  output,
  workDir,
}: RenderInput): Promise<void> {
  writeFileSync(path.join(workDir, 'cuadros.ffconcat'), concatList(recording));
  writeWav(path.join(workDir, 'audio.wav'), mixAudio(cues, recording.duration), MIX_RATE);
  const { width, height } = VIDEO_SIZE;
  await runFfmpeg(
    [
      ['-f', 'concat', '-safe', '0', '-i', 'cuadros.ffconcat'],
      ['-i', 'audio.wav'],
      ['-map', '0:v:0', '-map', '1:a:0'],
      [
        '-vf',
        `fps=${String(FPS)},scale=${String(width)}:${String(height)}:flags=lanczos,format=yuv420p`,
      ],
      ['-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high'],
      ['-c:a', 'aac', '-b:a', '128k', '-ar', '48000'],
      ['-movflags', '+faststart', '-t', (recording.duration / 1000).toFixed(3)],
      [output],
    ].flat(),
    workDir,
  );
}

/** Lista de cuadros para ffmpeg: cada uno se ve hasta que llega el siguiente. */
function concatList({ frames, duration }: Recording): string {
  const sorted = [...frames].sort((a, b) => a.time - b.time);
  const lines = ['ffconcat version 1.0'];
  sorted.forEach((frame, index) => {
    const start = index === 0 ? 0 : frame.time;
    const end = sorted[index + 1]?.time ?? duration;
    if (end - start < 0.5) return;
    lines.push(
      `file '${path.basename(frame.file)}'`,
      `duration ${((end - start) / 1000).toFixed(4)}`,
    );
  });
  const last = sorted.at(-1);
  if (last !== undefined) lines.push(`file '${path.basename(last.file)}'`);
  return `${lines.join('\n')}\n`;
}

/** Pone cada frase y cada toque en su momento, y deja la voz a buen volumen. */
function mixAudio(cues: AudioCue[], durationMs: number): Float32Array {
  const mix = new Float32Array(Math.ceil((durationMs / 1000) * MIX_RATE));
  const tap = tapSound();
  for (const cue of cues) {
    const source = cue.kind === 'voice' ? toMixRate(readWav(cue.file)) : tap;
    const start = Math.round((cue.time / 1000) * MIX_RATE);
    source.forEach((sample, index) => {
      const at = start + index;
      if (at < mix.length) mix[at] = (mix[at] ?? 0) + sample;
    });
  }
  let peak = 0;
  for (const sample of mix) peak = Math.max(peak, Math.abs(sample));
  const gain = peak === 0 ? 1 : Math.min(3, 0.89 / peak);
  return mix.map((sample) => sample * gain);
}

function toMixRate({ samples, sampleRate }: WavData): Float32Array {
  if (sampleRate === MIX_RATE) return samples;
  const ratio = sampleRate / MIX_RATE;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  return out.map((_, index) => {
    const position = index * ratio;
    const base = Math.floor(position);
    const a = samples[base] ?? 0;
    const b = samples[base + 1] ?? a;
    return a + (b - a) * (position - base);
  });
}

/** "Clic" suave de cada toque (ruido y un tono corto que se apagan rápido). */
function tapSound(): Float32Array {
  const length = Math.round(MIX_RATE * 0.035);
  let seed = 7;
  return new Float32Array(length).map((_, index) => {
    seed = (seed * 16_807) % 2_147_483_647;
    const noise = (seed / 2_147_483_647) * 2 - 1;
    const t = index / MIX_RATE;
    return Math.exp(-t * 160) * (0.55 * Math.sin(2 * Math.PI * 1_500 * t) + 0.45 * noise) * 0.16;
  });
}
