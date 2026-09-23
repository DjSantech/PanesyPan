import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * argon2id con los parámetros mínimos recomendados por OWASP (19 MiB, 2 iteraciones, 1 hilo).
 * `Algorithm` es un const enum que no se puede importar en este proyecto: 2 = Argon2id.
 */
const ARGON2_OPTIONS: Options = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/** Cifra una contraseña o un PIN. Nunca se guardan en texto plano. */
export function hashSecret(secret: string): Promise<string> {
  return hash(secret, ARGON2_OPTIONS);
}

/** Compara un secreto con su hash. Devuelve `false` ante cualquier error (hash corrupto, etc.). */
export async function verifySecret(storedHash: string, secret: string): Promise<boolean> {
  try {
    return await verify(storedHash, secret);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Hace una verificación de relleno cuando el usuario no existe, para que la respuesta tarde
 * lo mismo y no se pueda averiguar qué usuarios existen midiendo el tiempo.
 */
export async function verifyAgainstDummy(secret: string): Promise<void> {
  dummyHash ??= hashSecret('relleno-para-igualar-tiempos');
  await verifySecret(await dummyHash, secret);
}
