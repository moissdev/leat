import { createHmac } from "node:crypto";

/**
 * Longitud mínima del pepper. Se recomienda generarlo con
 * `openssl rand -hex 32` (64 caracteres).
 */
export const MIN_PEPPER_LENGTH = 32;

/**
 * Huella del secreto: HMAC-SHA-256(secreto, pepper) en hexadecimal.
 * Determinista para deduplicar por proyecto, e inútil para fuerza bruta sin
 * el pepper (que solo vive en el servidor y llega como parámetro).
 */
export function fingerprintSecret(secret: string, pepper: string): string {
  if (pepper.length < MIN_PEPPER_LENGTH) {
    // El mensaje no incluye el valor del pepper.
    throw new Error(`El pepper debe tener al menos ${MIN_PEPPER_LENGTH} caracteres.`);
  }
  return createHmac("sha256", pepper).update(secret, "utf8").digest("hex");
}
