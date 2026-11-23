import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Enums, Json } from "@/types/database";

/**
 * Puerto de persistencia de los escaneos + implementación con Supabase.
 *
 * La lógica de negocio (`create.ts`, `process-chunk.ts`, …) solo conoce la
 * interfaz `ScanStore`, de modo que las pruebas usan una implementación en
 * memoria. Importar solo con `import type` desde la lógica de negocio.
 *
 * Reglas (CLAUDE.md): TODOS los métodos reciben el `userId` de la sesión
 * verificada y filtran por él, porque el cliente admin omite RLS.
 */

export type IngestType = Enums<"ingest_type">;
export type ScanStatus = Enums<"scan_status">;
export type FindingStatus = Enums<"finding_status">;
export type SeverityLevel = Enums<"severity_level">;
export type DetectionMethodValue = Enums<"detection_method">;

export interface ScanRecord {
  id: string;
  userId: string;
  projectId: string;
  ingest: IngestType;
  status: ScanStatus;
  filesScanned: number;
  bytesScanned: number;
  chunksReceived: number;
}

export interface NewScan {
  userId: string;
  projectId: string;
  ingest: IngestType;
  sourceRef: string | null;
}

export interface FindingRecord {
  id: string;
  projectId: string;
  fingerprint: string;
  secretType: string;
  severity: SeverityLevel;
  method: DetectionMethodValue;
  status: FindingStatus;
}

export interface NewFinding {
  userId: string;
  projectId: string;
  scanId: string;
  fingerprint: string;
  secretType: string;
  severity: SeverityLevel;
  method: DetectionMethodValue;
  maskedValue: string;
  detectedAt: Date;
}

/** Datos que se actualizan en un hallazgo re-detectado. */
export interface FindingTouch {
  scanId: string;
  detectedAt: Date;
  /** Presente solo si la nueva detección es más severa que la guardada. */
  upgrade?: {
    secretType: string;
    severity: SeverityLevel;
    method: DetectionMethodValue;
    maskedValue: string;
  };
}

export interface NewOccurrence {
  userId: string;
  findingId: string;
  scanId: string;
  filePath: string;
  lineNumber: number;
  maskedContext: string;
}

/** Resumen de un lote procesado; se guarda en `scan_logs.metadata` (sin contenido ni secretos). */
export const chunkSummarySchema = z.object({
  chunk_index: z.number().int().nonnegative(),
  files_received: z.number().int().nonnegative(),
  files_scanned: z.number().int().nonnegative(),
  files_skipped: z.number().int().nonnegative(),
  files_truncated: z.number().int().nonnegative(),
  bytes_scanned: z.number().int().nonnegative(),
  occurrences: z.number().int().nonnegative(),
  new_finding_ids: z.array(z.string()),
  reopened_finding_ids: z.array(z.string()),
});
export type ChunkSummary = z.infer<typeof chunkSummarySchema>;

export interface ScanProgress {
  chunksReceived: number;
  filesScanned: number;
  filesTruncated: number;
  bytesScanned: number;
  occurrencesTotal: number;
}

/** Cierre de un escaneo (`completed`). */
export interface CompletedScan {
  finishedAt: Date;
  isFullScan: boolean;
  filesTotal: number;
  filesSkipped: number;
  filesTruncated: number;
  findingsNew: number;
  findingsReopened: number;
  progress: ScanProgress;
}

/** Escaneo en curso con su última actividad conocida (para detectar huérfanos). */
export interface ActiveScanActivity {
  id: string;
  lastActivityAt: Date;
}

export interface ScanLogEntry {
  level: "info" | "warn" | "error";
  event: string;
  message?: string;
  /** Solo metadatos: NUNCA contenido de archivos ni secretos. */
  metadata?: Record<string, Json>;
}

export interface ScanStore {
  isProjectOwnedBy(userId: string, projectId: string): Promise<boolean>;
  countScansCreatedSince(userId: string, since: Date): Promise<number>;
  countActiveScans(userId: string): Promise<number>;
  insertScan(scan: NewScan): Promise<ScanRecord>;
  getScan(userId: string, scanId: string): Promise<ScanRecord | null>;
  /** Pasa de `queued` a `running` (no hace nada en otro estado). */
  markScanRunning(userId: string, scanId: string, at: Date): Promise<void>;
  hasChunk(userId: string, scanId: string, chunkIndex: number): Promise<boolean>;
  getFindingsByFingerprint(
    userId: string,
    projectId: string,
    fingerprints: readonly string[],
  ): Promise<FindingRecord[]>;
  /** Devuelve null si otra petición insertó la misma huella (conflicto único). */
  insertFinding(finding: NewFinding): Promise<FindingRecord | null>;
  touchFinding(userId: string, findingId: string, touch: FindingTouch): Promise<void>;
  /** `resolved` → `active` de forma condicional; devuelve true si lo reabrió. */
  reopenIfResolved(userId: string, findingId: string): Promise<boolean>;
  /** Inserta ignorando duplicados (finding, scan, archivo, línea). */
  insertOccurrences(occurrences: readonly NewOccurrence[]): Promise<void>;
  /** Registra el lote; "duplicate" si ese `chunk_index` ya estaba registrado. */
  recordChunk(userId: string, scanId: string, summary: ChunkSummary): Promise<"recorded" | "duplicate">;
  listChunkSummaries(userId: string, scanId: string): Promise<ChunkSummary[]>;
  updateScanProgress(userId: string, scanId: string, progress: ScanProgress): Promise<void>;
  logScanEvent(userId: string, scanId: string, entry: ScanLogEntry): Promise<void>;

  // ── Cierre y ciclo de vida (checkpoint 11)
  /** IDs de los hallazgos `active` de un proyecto. */
  listActiveFindingIds(userId: string, projectId: string): Promise<string[]>;
  /** IDs (sin repetir) de los hallazgos con alguna ocurrencia en el escaneo. */
  listFindingIdsSeenInScan(userId: string, scanId: string): Promise<string[]>;
  /** `active` → `resolved` de forma condicional; devuelve cuántos resolvió. */
  resolveFindings(userId: string, findingIds: readonly string[], reason: string): Promise<number>;
  /** `queued`/`running` → `completed`; devuelve false si el escaneo ya no estaba abierto. */
  completeScan(userId: string, scanId: string, result: CompletedScan): Promise<boolean>;
  /** Escaneos `queued`/`running` creados antes de `createdBefore`, con su última actividad. */
  listActiveScansCreatedBefore(userId: string, createdBefore: Date): Promise<ActiveScanActivity[]>;
  /** `queued`/`running` → `failed`; devuelve false si ya no estaba abierto. */
  failScan(userId: string, scanId: string, message: string, at: Date): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Implementación con Supabase (cliente admin, service_role)
// ─────────────────────────────────────────────────────────────────────────────

/** Evento de `scan_logs` que marca un lote procesado. */
export const CHUNK_EVENT = "chunk_processed";
/** Huellas por consulta `in (...)`, para no exceder el largo de URL de PostgREST. */
const FINGERPRINT_QUERY_BATCH = 100;
const UNIQUE_VIOLATION = "23505";
/** Filas por página: PostgREST de Supabase devuelve como máximo 1,000 por consulta. */
const PAGE_SIZE = 1000;
/** IDs por actualización `in (...)`. */
const ID_UPDATE_BATCH = 100;

type AdminClient = SupabaseClient<Database>;

/** Error de persistencia sin datos de la fila (solo el código de Postgres/PostgREST). */
export class PersistenceError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string | undefined,
  ) {
    super(`Fallo de persistencia en ${operation}${code ? ` (${code})` : ""}`);
    this.name = "PersistenceError";
  }
}

function fail(operation: string, error: { code?: string } | null): never {
  throw new PersistenceError(operation, error?.code);
}

const SCAN_COLUMNS = "id, user_id, project_id, ingest, status, files_scanned, bytes_scanned, chunks_received";
const FINDING_COLUMNS = "id, project_id, fingerprint, secret_type, severity, method, status";

function toScan(row: {
  id: string;
  user_id: string;
  project_id: string;
  ingest: IngestType;
  status: ScanStatus;
  files_scanned: number;
  bytes_scanned: number;
  chunks_received: number;
}): ScanRecord {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    ingest: row.ingest,
    status: row.status,
    filesScanned: row.files_scanned,
    bytesScanned: Number(row.bytes_scanned),
    chunksReceived: row.chunks_received,
  };
}

function toFinding(row: {
  id: string;
  project_id: string;
  fingerprint: string;
  secret_type: string;
  severity: SeverityLevel;
  method: DetectionMethodValue;
  status: FindingStatus;
}): FindingRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    fingerprint: row.fingerprint,
    secretType: row.secret_type,
    severity: row.severity,
    method: row.method,
    status: row.status,
  };
}

export class SupabaseScanStore implements ScanStore {
  constructor(private readonly db: AdminClient) {}

  async isProjectOwnedBy(userId: string, projectId: string): Promise<boolean> {
    const { count, error } = await this.db
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("id", projectId)
      .eq("user_id", userId);
    if (error) fail("isProjectOwnedBy", error);
    return (count ?? 0) > 0;
  }

  async countScansCreatedSince(userId: string, since: Date): Promise<number> {
    const { count, error } = await this.db
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since.toISOString());
    if (error) fail("countScansCreatedSince", error);
    return count ?? 0;
  }

  async countActiveScans(userId: string): Promise<number> {
    const { count, error } = await this.db
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ["queued", "running"]);
    if (error) fail("countActiveScans", error);
    return count ?? 0;
  }

  async insertScan(scan: NewScan): Promise<ScanRecord> {
    const { data, error } = await this.db
      .from("scans")
      .insert({
        user_id: scan.userId,
        project_id: scan.projectId,
        ingest: scan.ingest,
        source_ref: scan.sourceRef,
      })
      .select(SCAN_COLUMNS)
      .single();
    if (error || !data) fail("insertScan", error);
    return toScan(data);
  }

  async getScan(userId: string, scanId: string): Promise<ScanRecord | null> {
    const { data, error } = await this.db
      .from("scans")
      .select(SCAN_COLUMNS)
      .eq("id", scanId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) fail("getScan", error);
    return data ? toScan(data) : null;
  }

  async markScanRunning(userId: string, scanId: string, at: Date): Promise<void> {
    const { error } = await this.db
      .from("scans")
      .update({ status: "running", started_at: at.toISOString() })
      .eq("id", scanId)
      .eq("user_id", userId)
      .eq("status", "queued");
    if (error) fail("markScanRunning", error);
  }

  async hasChunk(userId: string, scanId: string, chunkIndex: number): Promise<boolean> {
    const { count, error } = await this.db
      .from("scan_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("scan_id", scanId)
      .eq("event", CHUNK_EVENT)
      .eq("metadata->>chunk_index", String(chunkIndex));
    if (error) fail("hasChunk", error);
    return (count ?? 0) > 0;
  }

  async getFindingsByFingerprint(
    userId: string,
    projectId: string,
    fingerprints: readonly string[],
  ): Promise<FindingRecord[]> {
    const results: FindingRecord[] = [];
    for (let i = 0; i < fingerprints.length; i += FINGERPRINT_QUERY_BATCH) {
      const batch = fingerprints.slice(i, i + FINGERPRINT_QUERY_BATCH);
      const { data, error } = await this.db
        .from("findings")
        .select(FINDING_COLUMNS)
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .in("fingerprint", batch);
      if (error) fail("getFindingsByFingerprint", error);
      results.push(...(data ?? []).map(toFinding));
    }
    return results;
  }

  async insertFinding(finding: NewFinding): Promise<FindingRecord | null> {
    const at = finding.detectedAt.toISOString();
    const { data, error } = await this.db
      .from("findings")
      .insert({
        user_id: finding.userId,
        project_id: finding.projectId,
        fingerprint: finding.fingerprint,
        secret_type: finding.secretType,
        severity: finding.severity,
        method: finding.method,
        masked_value: finding.maskedValue,
        first_scan_id: finding.scanId,
        last_scan_id: finding.scanId,
        first_detected_at: at,
        last_detected_at: at,
      })
      .select(FINDING_COLUMNS)
      .single();
    if (error?.code === UNIQUE_VIOLATION) return null;
    if (error || !data) fail("insertFinding", error);
    return toFinding(data);
  }

  async touchFinding(userId: string, findingId: string, touch: FindingTouch): Promise<void> {
    const { error } = await this.db
      .from("findings")
      .update({
        last_scan_id: touch.scanId,
        last_detected_at: touch.detectedAt.toISOString(),
        ...(touch.upgrade
          ? {
              secret_type: touch.upgrade.secretType,
              severity: touch.upgrade.severity,
              method: touch.upgrade.method,
              masked_value: touch.upgrade.maskedValue,
            }
          : {}),
      })
      .eq("id", findingId)
      .eq("user_id", userId);
    if (error) fail("touchFinding", error);
  }

  async reopenIfResolved(userId: string, findingId: string): Promise<boolean> {
    // El trigger registra la transición (actor system) con el motivo de status_note.
    const { data, error } = await this.db
      .from("findings")
      .update({ status: "active", status_note: "redetected" })
      .eq("id", findingId)
      .eq("user_id", userId)
      .eq("status", "resolved")
      .select("id");
    if (error) fail("reopenIfResolved", error);
    return (data ?? []).length > 0;
  }

  async insertOccurrences(occurrences: readonly NewOccurrence[]): Promise<void> {
    if (occurrences.length === 0) return;
    const { error } = await this.db.from("finding_occurrences").upsert(
      occurrences.map((o) => ({
        user_id: o.userId,
        finding_id: o.findingId,
        scan_id: o.scanId,
        file_path: o.filePath,
        line_number: o.lineNumber,
        masked_context: o.maskedContext,
      })),
      { onConflict: "finding_id,scan_id,file_path,line_number", ignoreDuplicates: true },
    );
    if (error) fail("insertOccurrences", error);
  }

  async recordChunk(
    userId: string,
    scanId: string,
    summary: ChunkSummary,
  ): Promise<"recorded" | "duplicate"> {
    const { error } = await this.db.from("scan_logs").insert({
      user_id: userId,
      scan_id: scanId,
      level: "info",
      event: CHUNK_EVENT,
      metadata: summary,
    });
    if (error?.code === UNIQUE_VIOLATION) return "duplicate";
    if (error) fail("recordChunk", error);
    return "recorded";
  }

  async listChunkSummaries(userId: string, scanId: string): Promise<ChunkSummary[]> {
    const { data, error } = await this.db
      .from("scan_logs")
      .select("metadata")
      .eq("user_id", userId)
      .eq("scan_id", scanId)
      .eq("event", CHUNK_EVENT);
    if (error) fail("listChunkSummaries", error);
    return (data ?? []).flatMap((row) => {
      const parsed = chunkSummarySchema.safeParse(row.metadata);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async updateScanProgress(userId: string, scanId: string, progress: ScanProgress): Promise<void> {
    const { error } = await this.db
      .from("scans")
      .update({
        chunks_received: progress.chunksReceived,
        files_scanned: progress.filesScanned,
        files_truncated: progress.filesTruncated,
        bytes_scanned: progress.bytesScanned,
        occurrences_total: progress.occurrencesTotal,
      })
      .eq("id", scanId)
      .eq("user_id", userId);
    if (error) fail("updateScanProgress", error);
  }

  async logScanEvent(userId: string, scanId: string, entry: ScanLogEntry): Promise<void> {
    const { error } = await this.db.from("scan_logs").insert({
      user_id: userId,
      scan_id: scanId,
      level: entry.level,
      event: entry.event,
      message: entry.message ?? null,
      metadata: entry.metadata ?? {},
    });
    if (error) fail("logScanEvent", error);
  }

  /** Lee todas las páginas de una consulta (PostgREST limita las filas por respuesta). */
  private async readAllPages<T>(
    operation: string,
    page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string } | null }>,
  ): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await page(from, from + PAGE_SIZE - 1);
      if (error) fail(operation, error);
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE_SIZE) return rows;
    }
  }

  async listActiveFindingIds(userId: string, projectId: string): Promise<string[]> {
    const rows = await this.readAllPages("listActiveFindingIds", (from, to) =>
      this.db
        .from("findings")
        .select("id")
        .eq("user_id", userId)
        .eq("project_id", projectId)
        .eq("status", "active")
        .order("id")
        .range(from, to),
    );
    return rows.map((r) => r.id);
  }

  async listFindingIdsSeenInScan(userId: string, scanId: string): Promise<string[]> {
    const rows = await this.readAllPages("listFindingIdsSeenInScan", (from, to) =>
      this.db
        .from("finding_occurrences")
        .select("finding_id")
        .eq("user_id", userId)
        .eq("scan_id", scanId)
        .order("id")
        .range(from, to),
    );
    return [...new Set(rows.map((r) => r.finding_id))];
  }

  async resolveFindings(userId: string, findingIds: readonly string[], reason: string): Promise<number> {
    let resolved = 0;
    for (let i = 0; i < findingIds.length; i += ID_UPDATE_BATCH) {
      // El trigger registra la transición (actor system) y el TTR.
      const { data, error } = await this.db
        .from("findings")
        .update({ status: "resolved", status_note: reason })
        .eq("user_id", userId)
        .eq("status", "active")
        .in("id", findingIds.slice(i, i + ID_UPDATE_BATCH))
        .select("id");
      if (error) fail("resolveFindings", error);
      resolved += (data ?? []).length;
    }
    return resolved;
  }

  async completeScan(userId: string, scanId: string, result: CompletedScan): Promise<boolean> {
    const { data, error } = await this.db
      .from("scans")
      .update({
        status: "completed",
        finished_at: result.finishedAt.toISOString(),
        is_full_scan: result.isFullScan,
        files_total: result.filesTotal,
        files_skipped: result.filesSkipped,
        files_truncated: result.filesTruncated,
        findings_new: result.findingsNew,
        findings_reopened: result.findingsReopened,
        chunks_received: result.progress.chunksReceived,
        files_scanned: result.progress.filesScanned,
        bytes_scanned: result.progress.bytesScanned,
        occurrences_total: result.progress.occurrencesTotal,
      })
      .eq("id", scanId)
      .eq("user_id", userId)
      .in("status", ["queued", "running"])
      .select("id");
    if (error) fail("completeScan", error);
    return (data ?? []).length > 0;
  }

  async listActiveScansCreatedBefore(userId: string, createdBefore: Date): Promise<ActiveScanActivity[]> {
    const { data, error } = await this.db
      .from("scans")
      .select("id, created_at, started_at")
      .eq("user_id", userId)
      .in("status", ["queued", "running"])
      .lt("created_at", createdBefore.toISOString());
    if (error) fail("listActiveScansCreatedBefore", error);

    const result: ActiveScanActivity[] = [];
    for (const scan of data ?? []) {
      const last = await this.db
        .from("scan_logs")
        .select("created_at")
        .eq("user_id", userId)
        .eq("scan_id", scan.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last.error) fail("listActiveScansCreatedBefore", last.error);
      const times = [scan.created_at, scan.started_at, last.data?.created_at]
        .filter((t): t is string => typeof t === "string")
        .map((t) => new Date(t).getTime());
      result.push({ id: scan.id, lastActivityAt: new Date(Math.max(...times)) });
    }
    return result;
  }

  async failScan(userId: string, scanId: string, message: string, at: Date): Promise<boolean> {
    const { data, error } = await this.db
      .from("scans")
      .update({ status: "failed", error_message: message, finished_at: at.toISOString() })
      .eq("id", scanId)
      .eq("user_id", userId)
      .in("status", ["queued", "running"])
      .select("id");
    if (error) fail("failScan", error);
    return (data ?? []).length > 0;
  }
}
