import { randomUUID } from "node:crypto";
import type {
  ActiveScanActivity,
  ChunkSummary,
  CompletedScan,
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
  finishedAt: Date | null;
  filesTotal: number;
  filesSkipped: number;
  filesTruncated: number;
  occurrencesTotal: number;
  findingsNew: number;
  findingsReopened: number;
  isFullScan: boolean;
  errorMessage: string | null;
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
  logs: {
    userId: string;
    scanId: string;
    level: string;
    event: string;
    message: string | null;
    metadata: unknown;
    createdAt: Date;
  }[] = [];
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
      finishedAt: null,
      filesTotal: 0,
      filesSkipped: 0,
      filesTruncated: 0,
      occurrencesTotal: 0,
      findingsNew: 0,
      findingsReopened: 0,
      isFullScan: false,
      errorMessage: null,
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
    this.logs.push({
      userId,
      scanId,
      level: "info",
      event: "chunk_processed",
      message: null,
      metadata: summary,
      createdAt: new Date(this.clock),
    });
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
      createdAt: new Date(this.clock),
    });
  }

  async listActiveFindingIds(userId: string, projectId: string): Promise<string[]> {
    return this.findings
      .filter((f) => f.userId === userId && f.projectId === projectId && f.status === "active")
      .map((f) => f.id);
  }

  async listFindingIdsSeenInScan(userId: string, scanId: string): Promise<string[]> {
    return [...new Set(this.occurrences.filter((o) => o.userId === userId && o.scanId === scanId).map((o) => o.findingId))];
  }

  async resolveFindings(userId: string, findingIds: readonly string[], reason: string): Promise<number> {
    let resolved = 0;
    for (const f of this.findings) {
      if (f.userId === userId && f.status === "active" && findingIds.includes(f.id)) {
        this.setStatus(f, "resolved", reason);
        resolved += 1;
      }
    }
    return resolved;
  }

  async completeScan(userId: string, scanId: string, result: CompletedScan): Promise<boolean> {
    const scan = this.openScan(userId, scanId);
    if (!scan) return false;
    Object.assign(scan, result.progress, {
      status: "completed",
      finishedAt: result.finishedAt,
      isFullScan: result.isFullScan,
      filesTotal: result.filesTotal,
      filesSkipped: result.filesSkipped,
      filesTruncated: result.filesTruncated,
      findingsNew: result.findingsNew,
      findingsReopened: result.findingsReopened,
    });
    return true;
  }

  async listActiveScansCreatedBefore(userId: string, createdBefore: Date): Promise<ActiveScanActivity[]> {
    return this.scans
      .filter((s) => s.userId === userId && (s.status === "queued" || s.status === "running") && s.createdAt < createdBefore)
      .map((s) => {
        const times = [s.createdAt, s.startedAt, ...this.logs.filter((l) => l.scanId === s.id).map((l) => l.createdAt)]
          .filter((t): t is Date => t instanceof Date)
          .map((t) => t.getTime());
        return { id: s.id, lastActivityAt: new Date(Math.max(...times)) };
      });
  }

  async failScan(userId: string, scanId: string, message: string, at: Date): Promise<boolean> {
    const scan = this.openScan(userId, scanId);
    if (!scan) return false;
    scan.status = "failed";
    scan.errorMessage = message;
    scan.finishedAt = at;
    return true;
  }

  async setScanSourceRef(userId: string, scanId: string, sourceRef: string): Promise<void> {
    const scan = this.scans.find((s) => s.id === scanId && s.userId === userId);
    if (scan) scan.sourceRef = sourceRef;
  }

  private openScan(userId: string, scanId: string): MemoryScan | undefined {
    return this.scans.find(
      (s) => s.id === scanId && s.userId === userId && (s.status === "queued" || s.status === "running"),
    );
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
