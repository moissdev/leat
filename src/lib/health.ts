/** Respuesta pública de `/api/health`. No incluye configuración ni datos sensibles. */
export interface HealthPayload {
  status: "ok";
  /** Primeros 7 caracteres del commit desplegado (Vercel), o null en local. */
  commit: string | null;
  timestamp: string;
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/** Construye la respuesta de salud a partir del SHA del commit (si existe) y la hora actual. */
export function buildHealthPayload(commitSha: string | undefined, now: Date): HealthPayload {
  const commit =
    commitSha && COMMIT_SHA_PATTERN.test(commitSha) ? commitSha.slice(0, 7).toLowerCase() : null;
  return { status: "ok", commit, timestamp: now.toISOString() };
}
