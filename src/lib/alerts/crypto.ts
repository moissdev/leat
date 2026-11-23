import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifrado del webhook de Discord con AES-256-GCM (decisiones técnicas, sección 2).
 *
 * - IV aleatorio de 12 bytes por cifrado; etiqueta de autenticación de 16 bytes.
 * - El `user_id` va como dato asociado (AAD): un texto cifrado copiado a la
 *   fila de otro usuario no se puede descifrar.
 * - `key_version` permite rotar la clave sin perder los webhooks guardados.
 *
 * La clave llega como parámetro (el módulo no lee variables de entorno).
 */

export const CURRENT_KEY_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedSecret {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
  keyVersion: number;
}

/**
 * Convierte la clave configurada en 32 bytes. Formatos aceptados:
 * 64 caracteres hex, base64 que decodifique a 32 bytes, o 32 caracteres ASCII
 * tomados literalmente. El error nunca incluye el valor.
 */
export function parseEncryptionKey(raw: string): Buffer {
  const value = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");

  if (/^[A-Za-z0-9+/_-]{43}={0,1}$/.test(value)) {
    const decoded = Buffer.from(value, value.includes("-") || value.includes("_") ? "base64url" : "base64");
    if (decoded.length === KEY_BYTES) return decoded;
  }

  if (/^[\x21-\x7e]{32}$/.test(value)) return Buffer.from(value, "ascii");

  throw new Error(
    "La clave de cifrado debe ser de 32 bytes: 64 caracteres hex, base64 de 32 bytes o 32 caracteres ASCII.",
  );
}

export function encryptSecret(plaintext: string, key: Buffer, associatedData: string): EncryptedSecret {
  if (key.length !== KEY_BYTES) throw new Error("La clave de cifrado debe medir 32 bytes.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

/** Descifra; lanza un error si el texto, el IV, la etiqueta o el AAD fueron alterados. */
export function decryptSecret(secret: EncryptedSecret, key: Buffer, associatedData: string): string {
  if (key.length !== KEY_BYTES) throw new Error("La clave de cifrado debe medir 32 bytes.");
  const iv = Buffer.from(secret.iv, "base64");
  const tag = Buffer.from(secret.tag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Datos cifrados inválidos.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Mensaje fijo: no se filtran detalles del fallo de autenticación.
    throw new Error("No se pudo descifrar: datos alterados o clave incorrecta.");
  }
}
