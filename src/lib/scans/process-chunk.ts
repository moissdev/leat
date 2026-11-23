import { SCAN_LIMITS } from "../config";
import { getSkipReason, scanFile, utf8ByteLength, type Detection, type Severity } from "../engine";
import type {
  ChunkSummary,
  FindingRecord,
  NewOccurrence,
  ScanProgress,
  ScanRecord,
  ScanStore,
} from "./persist";
import type { ChunkInput } from "./schemas";

/**
 * Procesa un lote de archivos de un escaneo orquestado por el cliente
 * (snippet, archivo o ZIP): analiza en memoria, persiste hallazgos y
 * ocurrencias (ya enmascarados) y descarta el código.
 *
 * Idempotencia por `chunk_index`: hallazgos y ocurrencias son idempotentes
 * por sus restricciones únicas, y los contadores del escaneo se recalculan
 * a partir de los lotes registrados, así que un reintento no duplica nada.
 */

/** Límite de la columna `finding_occurrences.masked_context`. */
export const MAX_STORED_CONTEXT = 300;

/** Operaciones de hallazgos simultáneas por lote (cada una es una petición a la base). */
const FINDING_CONCURRENCY = 8;

const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export type ProcessChunkResult =
  | { ok: true; duplicate: boolean; summary: ChunkSummary | null }
  | { ok: false; error: "scan_not_found" | "scan_not_accepting_chunks" };

export interface ProcessChunkOptions {
  pepper: string;
  now: Date;
}

interface LocatedDetection extends Detection {
  path: string;
}

/**
 * Recorta un contexto YA ENMASCARADO a `max` caracteres, centrado en el valor
 * enmascarado. Usa `…` para indicar lo omitido.
 */
export function clipContext(context: string, maskedValue: string, max = MAX_STORED_CONTEXT): string {
  if (context.length <= max) return context;
  const index = context.indexOf(maskedValue);
  const center = index >= 0 ? index + Math.floor(maskedValue.length / 2) : 0;
  const room = max - 2; // espacio para los dos "…"
  let start = Math.max(0, center - Math.floor(room / 2));
  const end = Math.min(context.length, start + room);
  start = Math.max(0, end - room);
  return `${start > 0 ? "…" : ""}${context.slice(start, end)}${end < context.length ? "…" : ""}`;
}

/** Ejecuta `task` sobre cada elemento con, como máximo, `limit` tareas simultáneas. */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Suma los lotes registrados para obtener el progreso del escaneo. */
export function sumChunks(summaries: readonly ChunkSummary[]): ScanProgress {
  return summaries.reduce<ScanProgress>(
    (acc, s) => ({
      chunksReceived: acc.chunksReceived + 1,
      filesScanned: acc.filesScanned + s.files_scanned,
      filesTruncated: acc.filesTruncated + s.files_truncated,
      bytesScanned: acc.bytesScanned + s.bytes_scanned,
      occurrencesTotal: acc.occurrencesTotal + s.occurrences,
    }),
    { chunksReceived: 0, filesScanned: 0, filesTruncated: 0, bytesScanned: 0, occurrencesTotal: 0 },
  );
}

export async function processChunk(
  store: ScanStore,
  userId: string,
  scanId: string,
  chunk: ChunkInput,
  options: ProcessChunkOptions,
): Promise<ProcessChunkResult> {
  const scan = await store.getScan(userId, scanId);
  if (!scan) return { ok: false, error: "scan_not_found" };
  // GitHub lo orquesta el servidor: no acepta lotes desde la API.
  if (scan.ingest === "github") return { ok: false, error: "scan_not_accepting_chunks" };
  return processScanChunk(store, userId, scan, chunk, options);
}

/**
 * Núcleo del procesamiento de un lote para un escaneo ya cargado y del
 * usuario. Lo usan la API de lotes y el escaneo de GitHub (servidor).
 */
export async function processScanChunk(
  store: ScanStore,
  userId: string,
  scan: ScanRecord,
  chunk: ChunkInput,
  options: ProcessChunkOptions,
): Promise<ProcessChunkResult> {
  const scanId = scan.id;
  if (scan.status !== "queued" && scan.status !== "running") {
    return { ok: false, error: "scan_not_accepting_chunks" };
  }
  if (await store.hasChunk(userId, scanId, chunk.chunk_index)) {
    return { ok: true, duplicate: true, summary: null };
  }
  if (scan.status === "queued") await store.markScanRunning(userId, scanId, options.now);

  // ── 1. Análisis en memoria, respetando los límites del escaneo en el servidor.
  let remainingFiles = SCAN_LIMITS.maxFilesPerScan - scan.filesScanned;
  let remainingBytes = SCAN_LIMITS.maxScanTextBytes - scan.bytesScanned;
  let filesScanned = 0;
  let filesSkipped = 0;
  let filesTruncated = 0;
  let bytesScanned = 0;
  const detections: LocatedDetection[] = [];

  for (const file of chunk.files) {
    const reason = getSkipReason(file);
    if (reason === "too_large") {
      filesTruncated += 1;
      continue;
    }
    if (reason !== null) {
      filesSkipped += 1;
      continue;
    }
    const size = utf8ByteLength(file.content);
    if (remainingFiles <= 0 || size > remainingBytes) {
      filesTruncated += 1;
      continue;
    }
    remainingFiles -= 1;
    remainingBytes -= size;
    filesScanned += 1;
    bytesScanned += size;
    for (const detection of scanFile(file, { pepper: options.pepper })) {
      detections.push({ ...detection, path: file.path });
    }
  }

  // ── 2. Hallazgos: uno por huella; se conserva la detección más severa.
  const strongest = new Map<string, LocatedDetection>();
  for (const d of detections) {
    const current = strongest.get(d.fingerprint);
    if (!current || SEVERITY_RANK[d.severity] > SEVERITY_RANK[current.severity]) {
      strongest.set(d.fingerprint, d);
    }
  }

  const findingsByFingerprint = new Map<string, FindingRecord>();
  for (const f of await store.getFindingsByFingerprint(userId, scan.projectId, [...strongest.keys()])) {
    findingsByFingerprint.set(f.fingerprint, f);
  }

  const newFindingIds: string[] = [];
  const reopenedFindingIds: string[] = [];

  /** Registra (o re-detecta) el hallazgo de una huella. Independiente entre huellas. */
  const upsertFinding = async ([fingerprint, d]: [string, LocatedDetection]): Promise<void> => {
    let finding = findingsByFingerprint.get(fingerprint);
    if (!finding) {
      const inserted = await store.insertFinding({
        userId,
        projectId: scan.projectId,
        scanId,
        fingerprint,
        secretType: d.secretType,
        severity: d.severity,
        method: d.method,
        maskedValue: d.maskedValue,
        detectedAt: options.now,
      });
      if (inserted) {
        newFindingIds.push(inserted.id);
        findingsByFingerprint.set(fingerprint, inserted);
        return;
      }
      // Otra petición lo insertó en paralelo: se trata como existente.
      [finding] = await store.getFindingsByFingerprint(userId, scan.projectId, [fingerprint]);
      if (!finding) return;
      findingsByFingerprint.set(fingerprint, finding);
    }

    // Solo `resolved` se reabre; `ignored` y `false_positive` los decide el usuario.
    if (finding.status === "resolved" && (await store.reopenIfResolved(userId, finding.id))) {
      reopenedFindingIds.push(finding.id);
    }
    const isStronger = SEVERITY_RANK[d.severity] > SEVERITY_RANK[finding.severity];
    await store.touchFinding(userId, finding.id, {
      scanId,
      detectedAt: options.now,
      upgrade: isStronger
        ? { secretType: d.secretType, severity: d.severity, method: d.method, maskedValue: d.maskedValue }
        : undefined,
    });
  };

  await runWithConcurrency([...strongest], FINDING_CONCURRENCY, upsertFinding);

  // ── 3. Ocurrencias (una por hallazgo, archivo y línea).
  const occurrences = new Map<string, NewOccurrence>();
  for (const d of detections) {
    const finding = findingsByFingerprint.get(d.fingerprint);
    if (!finding) continue;
    const key = `${finding.id}\u0000${d.path}\u0000${d.line}`;
    if (occurrences.has(key)) continue;
    occurrences.set(key, {
      userId,
      findingId: finding.id,
      scanId,
      filePath: d.path,
      lineNumber: d.line,
      maskedContext: clipContext(d.maskedContext, d.maskedValue),
    });
  }
  await store.insertOccurrences([...occurrences.values()]);

  // ── 4. Registro del lote y recálculo de contadores.
  const summary: ChunkSummary = {
    chunk_index: chunk.chunk_index,
    files_received: chunk.files.length,
    files_scanned: filesScanned,
    files_skipped: filesSkipped,
    files_truncated: filesTruncated,
    bytes_scanned: bytesScanned,
    occurrences: occurrences.size,
    new_finding_ids: newFindingIds,
    reopened_finding_ids: reopenedFindingIds,
  };

  if ((await store.recordChunk(userId, scanId, summary)) === "duplicate") {
    return { ok: true, duplicate: true, summary: null };
  }
  await store.updateScanProgress(userId, scanId, sumChunks(await store.listChunkSummaries(userId, scanId)));

  return { ok: true, duplicate: false, summary };
}
