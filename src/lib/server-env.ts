import "server-only";
import { CURRENT_KEY_VERSION, parseEncryptionKey } from "./alerts/crypto";
import { MIN_PEPPER_LENGTH } from "./engine";
import { requireEnv } from "./supabase/env";

/** Pepper de las huellas HMAC. Solo servidor; el valor nunca se registra. */
export function getFingerprintPepper(): string {
  const pepper = requireEnv("LEAT_FINGERPRINT_PEPPER", process.env.LEAT_FINGERPRINT_PEPPER);
  if (pepper.length < MIN_PEPPER_LENGTH) {
    throw new Error(`LEAT_FINGERPRINT_PEPPER debe tener al menos ${MIN_PEPPER_LENGTH} caracteres`);
  }
  return pepper;
}

/**
 * Clave AES-256-GCM del webhook según su versión. Hoy solo existe la v1
 * (`LEAT_WEBHOOK_ENCRYPTION_KEY`); una rotación agregaría la v2 aquí.
 */
export function getWebhookEncryptionKey(version: number): Buffer {
  if (version !== CURRENT_KEY_VERSION) {
    throw new Error(`No hay clave de cifrado configurada para la versión ${version}`);
  }
  return parseEncryptionKey(
    requireEnv("LEAT_WEBHOOK_ENCRYPTION_KEY", process.env.LEAT_WEBHOOK_ENCRYPTION_KEY),
  );
}
