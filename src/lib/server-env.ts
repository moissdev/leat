import "server-only";
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
