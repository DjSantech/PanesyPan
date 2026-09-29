/**
 * Pasa a Cloudinary las fotos de productos que siguen guardadas en MongoDB y las borra de la
 * base de datos para liberar espacio. Se puede ejecutar varias veces: solo mueve las pendientes.
 *
 * Uso (desde backend/):  npm run images:to-cloudinary
 * Requiere CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET en el entorno.
 */
import { trusted } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { loadEnv } from '../src/config/env';
import { uploadImage } from '../src/lib/cloudinary';
import { ProductImageModel, ProductModel } from '../src/modules/catalog/catalog.models';
import {
  cloudinaryCredentials,
  configureImageStorage,
  PRODUCT_IMAGES_FOLDER,
} from '../src/modules/catalog/image-storage';

let exitCode = 0;
try {
  const env = loadEnv();
  configureImageStorage(env);
  const credentials = cloudinaryCredentials();
  if (credentials === null) throw new Error('Faltan las credenciales de Cloudinary');
  await connectDatabase({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });

  const products = await ProductModel.find({
    image: trusted({ $ne: null }),
    'image.url': trusted({ $in: [null, undefined] }),
  });
  let moved = 0;
  for (const product of products) {
    const current = product.image;
    if (current === null) continue;
    const stored = await ProductImageModel.findById(current.id);
    if (stored === null) {
      console.warn(`[imagenes] "${product.name}": la foto ya no existe en la base, se omite`);
      continue;
    }
    const uploaded = await uploadImage(
      credentials,
      { data: stored.data, contentType: stored.contentType },
      PRODUCT_IMAGES_FOLDER,
    );
    product.image = { ...current, url: uploaded.url, publicId: uploaded.publicId };
    await product.save();
    await ProductImageModel.deleteOne({ _id: stored._id });
    moved += 1;
    console.log(`[imagenes] "${product.name}" pasó a Cloudinary`);
  }
  // Fotos viejas que ya no usa ningún producto (quedaron huérfanas).
  const inUse = new Set(
    (await ProductModel.find({ image: trusted({ $ne: null }) }).select('image')).map((p) =>
      p.image?.id.toString(),
    ),
  );
  const orphans = (await ProductImageModel.find().select('_id')).filter(
    (image) => !inUse.has(image._id.toString()),
  );
  if (orphans.length > 0) {
    await ProductImageModel.deleteMany({ _id: trusted({ $in: orphans.map((o) => o._id) }) });
  }
  console.log(
    `[imagenes] Movidas: ${String(moved)} · huérfanas borradas: ${String(orphans.length)}`,
  );
} catch (error) {
  console.error(`[imagenes] ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  await disconnectDatabase().catch(() => undefined);
}
process.exit(exitCode);
