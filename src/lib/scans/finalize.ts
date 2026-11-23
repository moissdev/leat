import { autoResolveFindings, shouldAutoResolve } from "./auto-resolve";
import type { ScanRecord, ScanStore } from "./persist";
import { sumChunks } from "./process-chunk";
import type { FinalizeInput } from "./schemas";

/**
 * Cierre de un escaneo: consolida contadores, decide la cobertura
 * (`is_full_scan`), auto-resuelve si corresponde y deja el escaneo en
 * `completed`. Es idempotente: finalizar dos veces no repite nada.
 */

/** Conteos de la ingesta que el servidor no ve (archivos filtrados antes de enviarse). */
export interface IngestCounts {
  filesTotal: number;
  filesSkipped: number;
  filesTruncated: number;
}

export interface FinalizedScan {
  isFullScan: boolean;
  findingsNew: number;
  findingsReopened: number;
  autoResolved: number;
  /** Hallazgos nuevos y reabiertos del escaneo (insumo de las alertas). */
  newFindingIds: string[];
  reopenedFindingIds: string[];
}

export type FinalizeResult =
  | { ok: true; alreadyCompleted: false; result: FinalizedScan }
  | { ok: true; alreadyCompleted: true; result: null }
  | { ok: false; error: "scan_not_found" | "scan_not_open" };

/** Núcleo del cierre; lo reutiliza el escaneo de GitHub (checkpoint 13). */
export async function completeScan(
  store: ScanStore,
  userId: string,
  scan: ScanRecord,
  counts: IngestCounts,
  now: Date,
): Promise<FinalizeResult> {
  const summaries = await store.listChunkSummaries(userId, scan.id);
  const progress = sumChunks(summaries);
  const filesReceived = summaries.reduce((n, s) => n + s.files_received, 0);
  const serverSkipped = summaries.reduce((n, s) => n + s.files_skipped, 0);

  const filesTruncated = counts.filesTruncated + progress.filesTruncated;
  const filesSkipped = counts.filesSkipped + serverSkipped;
  const filesTotal = Math.max(counts.filesTotal, filesReceived + counts.filesSkipped + counts.filesTruncated);
  const isFullScan = filesTruncated === 0;

  const newFindingIds = [...new Set(summaries.flatMap((s) => s.new_finding_ids))];
  const reopenedFindingIds = [...new Set(summaries.flatMap((s) => s.reopened_finding_ids))];

  // Primero la auto-resolución (idempotente) y después el cierre: si algo
  // falla a la mitad, un reintento de finalize la completa.
  const autoResolved = shouldAutoResolve(scan.ingest, isFullScan)
    ? await autoResolveFindings(store, userId, scan.projectId, scan.id)
    : 0;

  const closed = await store.completeScan(userId, scan.id, {
    finishedAt: now,
    isFullScan,
    filesTotal,
    filesSkipped,
    filesTruncated,
    findingsNew: newFindingIds.length,
    findingsReopened: reopenedFindingIds.length,
    progress: { ...progress, filesTruncated },
  });
  if (!closed) return { ok: true, alreadyCompleted: true, result: null };

  await store.logScanEvent(userId, scan.id, {
    level: "info",
    event: "scan_completed",
    metadata: {
      is_full_scan: isFullScan,
      files_total: filesTotal,
      files_scanned: progress.filesScanned,
      files_skipped: filesSkipped,
      files_truncated: filesTruncated,
      findings_new: newFindingIds.length,
      findings_reopened: reopenedFindingIds.length,
      auto_resolved: autoResolved,
    },
  });

  return {
    ok: true,
    alreadyCompleted: false,
    result: {
      isFullScan,
      findingsNew: newFindingIds.length,
      findingsReopened: reopenedFindingIds.length,
      autoResolved,
      newFindingIds,
      reopenedFindingIds,
    },
  };
}

/** Finaliza un escaneo orquestado por el cliente (snippet, archivo o ZIP). */
export async function finalizeScan(
  store: ScanStore,
  userId: string,
  scanId: string,
  input: FinalizeInput,
  now: Date,
): Promise<FinalizeResult> {
  const scan = await store.getScan(userId, scanId);
  if (!scan) return { ok: false, error: "scan_not_found" };
  if (scan.status === "completed") return { ok: true, alreadyCompleted: true, result: null };
  if (scan.ingest === "github" || scan.status === "failed") return { ok: false, error: "scan_not_open" };

  return completeScan(
    store,
    userId,
    scan,
    {
      filesTotal: input.files_total,
      filesSkipped: input.files_skipped,
      filesTruncated: input.files_truncated,
    },
    now,
  );
}
