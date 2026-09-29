import { createHash } from 'node:crypto';

export interface CloudinaryCredentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export interface UploadedImage {
  /** URL https lista para mostrar (formato y calidad automáticos). */
  url: string;
  publicId: string;
}

const API = 'https://api.cloudinary.com/v1_1';

/**
 * Firma de Cloudinary: parámetros ordenados alfabéticamente, "clave=valor" unidos con "&",
 * más el secreto, en SHA-1. Así el secreto nunca viaja en la petición.
 */
export function signParams(params: Record<string, string>, apiSecret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key] ?? ''}`)
    .join('&');
  return createHash('sha1')
    .update(payload + apiSecret)
    .digest('hex');
}

/** Entrega con formato y calidad automáticos (WebP/AVIF según el navegador). */
export function deliveryUrl(secureUrl: string): string {
  return secureUrl.replace('/image/upload/', '/image/upload/f_auto,q_auto/');
}

async function call(
  credentials: CloudinaryCredentials,
  action: 'upload' | 'destroy',
  params: Record<string, string>,
  file?: { data: Buffer; contentType: string },
): Promise<Record<string, unknown>> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signed = { ...params, timestamp };
  const form = new FormData();
  for (const [key, value] of Object.entries(signed)) form.append(key, value);
  form.append('api_key', credentials.apiKey);
  form.append('signature', signParams(signed, credentials.apiSecret));
  if (file !== undefined) {
    form.append('file', new Blob([new Uint8Array(file.data)], { type: file.contentType }));
  }

  const response = await fetch(`${API}/${credentials.cloudName}/image/${action}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error as { message?: unknown } | undefined;
    const detail = typeof error?.message === 'string' ? error.message.slice(0, 160) : '';
    throw new Error(`Cloudinary respondió ${String(response.status)} ${detail}`.trim());
  }
  return body;
}

export async function uploadImage(
  credentials: CloudinaryCredentials,
  file: { data: Buffer; contentType: string },
  folder: string,
): Promise<UploadedImage> {
  const body = await call(credentials, 'upload', { folder }, file);
  const secureUrl = body.secure_url;
  const publicId = body.public_id;
  if (typeof secureUrl !== 'string' || !secureUrl.startsWith('https://')) {
    throw new Error('Cloudinary no devolvió una URL https');
  }
  if (typeof publicId !== 'string') throw new Error('Cloudinary no devolvió el id de la imagen');
  return { url: deliveryUrl(secureUrl), publicId };
}

export async function destroyImage(
  credentials: CloudinaryCredentials,
  publicId: string,
): Promise<void> {
  await call(credentials, 'destroy', { public_id: publicId, invalidate: 'true' });
}
