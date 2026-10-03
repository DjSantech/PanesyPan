import { readFileSync, writeFileSync } from 'node:fs';

export interface WavData {
  sampleRate: number;
  /** Muestras mono entre -1 y 1. */
  samples: Float32Array;
  durationMs: number;
}

/** Lee un WAV PCM de 16 bits (mono o estéreo) y lo devuelve en mono. */
export function readWav(file: string): WavData {
  const buffer = readFileSync(file);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${file} no es un archivo WAV`);
  }
  let format: { pcm: boolean; channels: number; sampleRate: number; bits: number } | null = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        pcm: buffer.readUInt16LE(body) === 1,
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (format === null || !format.pcm || format.bits !== 16) {
        throw new Error(`${file}: solo se leen WAV PCM de 16 bits`);
      }
      const { channels, sampleRate } = format;
      const frames = Math.floor(Math.min(size, buffer.length - body) / (2 * channels));
      const samples = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame++) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel++) {
          sum += buffer.readInt16LE(body + (frame * channels + channel) * 2);
        }
        samples[frame] = sum / channels / 32768;
      }
      return { sampleRate, samples, durationMs: (frames / sampleRate) * 1000 };
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${file}: el WAV no tiene audio`);
}

/** Escribe muestras mono (entre -1 y 1) como WAV PCM de 16 bits. */
export function writeWav(file: string, samples: Float32Array, sampleRate: number): void {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), index * 2);
  });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}
