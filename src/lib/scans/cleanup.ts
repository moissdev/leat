import { SCAN_LIFECYCLE } from "../config";
import type { ScanStore } from "./persist";

/** `error_message` de un escaneo abandonado (decisiones técnicas, sección 3.1). */
export const ORPHAN_ERROR_MESSAGE = "timeout";

/**
 * Limpieza perezosa: marca `failed` los escaneos `queued`/`running` del
 * usuario sin actividad (creación, inicio o registro en `scan_logs`) por más
 * de 15 minutos. Se llama al crear y al listar escaneos; no depende de cron.
 * Devuelve cuántos escaneos cerró.
 */
export async function failOrphanScans(store: ScanStore, userId: string, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - SCAN_LIFECYCLE.orphanTimeoutMs);
  const candidates = await store.listActiveScansCreatedBefore(userId, cutoff);

  let failed = 0;
  for (const scan of candidates) {
    if (scan.lastActivityAt >= cutoff) continue;
    if (await store.failScan(userId, scan.id, ORPHAN_ERROR_MESSAGE, now)) {
      failed += 1;
      await store.logScanEvent(userId, scan.id, {
        level: "warn",
        event: "scan_failed",
        message: "Escaneo sin actividad por más de 15 minutos.",
        metadata: { reason: ORPHAN_ERROR_MESSAGE },
      });
    }
  }
  return failed;
}
