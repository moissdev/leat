import type { ScanRecord, ScanStore } from "./persist";
import { checkScanRateLimit } from "./rate-limit";
import type { CreateScanInput } from "./schemas";

export type CreateScanResult =
  | { ok: true; scan: ScanRecord }
  | { ok: false; error: "project_not_found" | "hourly_limit" | "concurrent_limit" };

/**
 * Crea un escaneo en estado `queued`.
 * `userId` sale de la sesión verificada; el proyecto debe pertenecerle.
 */
export async function createScan(
  store: ScanStore,
  userId: string,
  input: CreateScanInput,
  now: Date,
): Promise<CreateScanResult> {
  if (!(await store.isProjectOwnedBy(userId, input.project_id))) {
    return { ok: false, error: "project_not_found" };
  }

  const limit = await checkScanRateLimit(store, userId, now);
  if (!limit.ok) return { ok: false, error: limit.reason };

  const sourceRef = input.ingest === "file" || input.ingest === "zip" ? input.source_name : null;
  const scan = await store.insertScan({
    userId,
    projectId: input.project_id,
    ingest: input.ingest,
    sourceRef,
  });

  await store.logScanEvent(userId, scan.id, {
    level: "info",
    event: "scan_created",
    metadata: { ingest: input.ingest },
  });

  return { ok: true, scan };
}
