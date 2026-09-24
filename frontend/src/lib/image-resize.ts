/** Lado mayor de las imágenes de producto: nítidas en la web y livianas para la tablet. */
const MAX_SIDE = 1200;
const QUALITY = 0.82;

const toBlob = (canvas: HTMLCanvasElement, type: string): Promise<Blob | null> =>
  new Promise((resolve) => {
    canvas.toBlob(resolve, type, QUALITY);
  });

/**
 * Reduce una foto (p. ej. de la cámara del celular, varios MB) a máximo 1200 px y la comprime
 * en WebP; si el navegador no sabe generar WebP (Safari), en JPEG. Así sube rápido y pesa ~100 KB.
 */
export async function resizeImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('No se pudo leer la imagen. Prueba con una foto JPG o PNG.');
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('El navegador no pudo procesar la imagen.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const webp = await toBlob(canvas, 'image/webp');
  if (webp?.type === 'image/webp') return webp;
  const jpeg = await toBlob(canvas, 'image/jpeg');
  if (jpeg === null) throw new Error('El navegador no pudo comprimir la imagen.');
  return jpeg;
}
