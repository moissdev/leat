import { randomUUID } from "node:crypto";
import type {
  ChunkSummary,
  FindingRecord,
  FindingStatus,
  FindingTouch,
  NewFinding,
  NewOccurrence,
  NewScan,
  ScanLogEntry,
  ScanProgress,
  ScanRecord,
  ScanStore,
} from "@/lib/scans/persist";

/** Fila de hallazgo en memoria (más columnas que `FindingRecord`, como en la tabla). */
export interface MemoryFinding extends FindingRecord {
  userId: string;
  maskedValue: string;
  statusNote: string | null;
  firstScanId: string;
  lastScanId: string;
  lastDetectedAt: Date;
}

export interface MemoryScan extends ScanRecord {
  sourceRef: string | null;
  createdAt: Date;
  startedAt: Date | null;
  filesTruncated: number;
  occurrencesTotal: number;
}

/**
 * Implementación en memoria de `ScanStore` para pruebas. Reproduce las
 * restricciones únicas del esquema y filtra siempre por `userId`.
 */
export class MemoryScanStore implements ScanStore {
  projects: { id: string; userId: string }[] = [];
  scans: MemoryScan[] = [];
  findings: MemoryFinding[] = [];
  occurrences: (NewOccurrence & { id: string })[] = [];
  logs: { userId: string; scanId: string; level: string; event: string; message: string | null; metadata: unknown }[] = [];
  /** Transiciones de estado, como las escribiría el trigger. */
  transitions: { findingId: string; from: FindingStatus | null; to: FindingStatus; reason: string | null }[] = [];
  /** Reloj de creación de escaneos (para el rate limit). */
  clock = new Date("2026-01-01T12:00:00Z");

  addProject(userId: string): string {
    const id = randomUUID();
    this.projects.push({ id, userId });
    return id;
  }

  async isProjectOwnedBy(userId: string, projectId: string): Promise<boolean> {
    return this.projects.some((p) => p.id === projectId && p.userId === userId);
  }

  async countScansCreatedSince(userId: string, since: Date): Promise<number> {
    return this.scans.filter((s) => s.userId === userId && s.createdAt >= since).length;
  }

  async countActiveScans(userId: string): Promise<number> {
    return this.scans.filter((s) => s.userId === userId && (s.status === "queued" || s.status === "running")).length;
  }

  async insertScan(scan: NewScan): Promise<ScanRecord> {
    const record: MemoryScan = {
      id: randomUUID(),
      userId: scan.userId,
      projectId: scan.projectId,
      ingest: scan.ingest,
      status: "queued",
      filesScanned: 0,
      bytesScanned: 0,
      chunksReceived: 0,
      sourceRef: scan.sourceRef,
      createdAt: new Date(this.clock),
      startedAt: null,
      filesTruncated: 0,
      occurrencesTotal: 0,
    };
    this.scans.push(record);
    return { ...record };
  }

  async getScan(userId: string, scanId: string): Promise<ScanRecord | null> {
    const scan = this.scans.find((s) => s.id === scanId && s.userId === userId);
    return scan ? { ...scan } : null;
  }

  async markScanRunning(userId: string, scanId: string, at: Date): Promise<void> {
    const scan = this.scans.find((s) => s.id === scanId && s.userId === userId && s.status === "queued");
    if (scan) {
      scan.status = "running";
      scan.startedAt = at;
    }
  }

  async hasChunk(userId: string, scanId: string, chunkIndex: number): Promise<boolean> {
    return this.chunkLogs(userId, scanId).some((s) => s.chunk_index === chunkIndex);
  }

  async getFindingsByFingerprint(
    userId: string,
    projectId: string,
    fingerprints: readonly string[],
  ): Promise<FindingRecord[]> {
    return this.findings
      .filter((f) => f.userId === userId && f.projectId === projectId && fingerprints.includes(f.fingerprint))
      .map((f) => ({ ...f }));
  }

  async insertFinding(finding: NewFinding): Promise<FindingRecord | null> {
    if (this.findings.some((f) => f.projectId === finding.projectId && f.fingerprint === finding.fingerprint)) {
      return null;
    }
    const row: MemoryFinding = {
      id: randomUUID(),
      userId: finding.userId,
      projectId: finding.projectId,
      fingerprint: finding.fingerprint,
      secretType: finding.secretType,
      severity: finding.severity,
      method: finding.method,
      status: "active",
      maskedValue: finding.maskedValue,
      statusNote: null,
      firstScanId: finding.scanId,
      lastScanId: finding.scanId,
      lastDetectedAt: finding.detectedAt,
    };
    this.findings.push(row);
    this.transitions.push({ findingId: row.id, from: null, to: "active", reason: "first_detected" });
    return { ...row };
  }

  async touchFinding(userId: string, findingId: string, touch: FindingTouch): Promise<void> {
    const f = this.findings.find((x) => x.id === findingId && x.userId === userId);
    if (!f) return;
    f.lastScanId = touch.scanId;
    f.lastDetectedAt = touch.detectedAt;
    if (touch.upgrade) Object.assign(f, touch.upgrade);
  }

  async reopenIfResolved(userId: string, findingId: string): Promise<boolean> {
    const f = this.findings.find((x) => x.id === findingId && x.userId === userId && x.status === "resolved");
    if (!f) return false;
    this.setStatus(f, "active", "redetected");
    return true;
  }

  async insertOccurrences(occurrences: readonly NewOccurrence[]): Promise<void> {
    for (const o of occurrences) {
      const duplicate = this.occurrences.some(
        (x) =>
          x.findingId === o.findingId && x.scanId === o.scanId && x.filePath === o.filePath && x.lineNumber === o.lineNumber,
      );
      if (!duplicate) this.occurrences.push({ ...o, id: randomUUID() });
    }
  }

  async recordChunk(userId: string, scanId: string, summary: ChunkSummary): Promise<"recorded" | "duplicate"> {
    if (await this.hasChunk(userId, scanId, summary.chunk_index)) return "duplicate";
    this.logs.push({ userId, scanId, level: "info", event: "chunk_processed", message: null, metadata: summary });
    return "recorded";
  }

  async listChunkSummaries(userId: string, scanId: string): Promise<ChunkSummary[]> {
    return this.chunkLogs(userId, scanId);
  }

  async updateScanProgress(userId: string, scanId: string, progress: ScanProgress): Promise<void> {
    const scan = this.scans.find((s) => s.id === scanId && s.userId === userId);
    if (scan) Object.assign(scan, progress);
  }

  async logScanEvent(userId: string, scanId: string, entry: ScanLogEntry): Promise<void> {
    this.logs.push({
      userId,
      scanId,
      level: entry.level,
      event: entry.event,
      message: entry.message ?? null,
      metadata: entry.metadata ?? {},
    });
  }

  /** Cambio de estado como lo haría el usuario o el sistema (registra la transición). */
  setStatus(finding: MemoryFinding, to: FindingStatus, reason: string | null): void {
    this.transitions.push({ findingId: finding.id, from: finding.status, to, reason });
    finding.status = to;
    finding.statusNote = reason;
  }

  private chunkLogs(userId: string, scanId: string): ChunkSummary[] {
    return this.logs
      .filter((l) => l.userId === userId && l.scanId === scanId && l.event === "chunk_processed")
      .map((l) => l.metadata as ChunkSummary);
  }
}
