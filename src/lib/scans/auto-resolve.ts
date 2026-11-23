import type { IngestType, ScanStore } from "./persist";

/** Motivo que el trigger guarda en el log de transición. */
export const AUTO_RESOLVE_REASON = "no_longer_detected";

/**
 * Solo un escaneo COMPLETO de ZIP o GitHub representa el estado del proyecto;
 * snippet y archivo suelto nunca auto-resuelven (decisiones técnicas, sección 5).
 */
export function shouldAutoResolve(ingest: IngestType, isFullScan: boolean): boolean {
  return isFullScan && (ingest === "zip" || ingest === "github");
}

/**
 * Pasa a `resolved` los hallazgos `active` del proyecto que no aparecieron en
 * el escaneo. Es idempotente: repetirlo no cambia nada. Devuelve cuántos resolvió.
 */
export async function autoResolveFindings(
  store: ScanStore,
  userId: string,
  projectId: string,
  scanId: string,
): Promise<number> {
  const [active, seen] = await Promise.all([
    store.listActiveFindingIds(userId, projectId),
    store.listFindingIdsSeenInScan(userId, scanId),
  ]);
  const seenSet = new Set(seen);
  const missing = active.filter((id) => !seenSet.has(id));
  return missing.length > 0 ? store.resolveFindings(userId, missing, AUTO_RESOLVE_REASON) : 0;
}
