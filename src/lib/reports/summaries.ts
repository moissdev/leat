import type { Json } from "@/types/database";
import type { Severity } from "../i18n/labels";
import { SCAN_ERROR_LABELS, SEVERITY_ORDER } from "../i18n/labels";

/** Funciones puras de los informes: describen logs y agregan métricas. */

export interface ScanLogDescription {
  title: string;
  detail: string | null;
}

function field(metadata: Json, key: string): Json | undefined {
  return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata) ? metadata[key] : undefined;
}

function num(metadata: Json, key: string): number {
  const value = field(metadata, key);
  return typeof value === "number" ? value : 0;
}

function text(metadata: Json, key: string): string | null {
  const value = field(metadata, key);
  return typeof value === "string" ? value : null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Describe un evento de `scan_logs` en español a partir de sus metadatos
 * (que nunca contienen código ni secretos).
 */
export function describeScanLog(event: string, metadata: Json): ScanLogDescription {
  switch (event) {
    case "scan_created":
      return { title: "Escaneo creado", detail: null };
    case "chunk_processed": {
      const parts = [
        plural(num(metadata, "files_scanned"), "archivo analizado", "archivos analizados"),
        num(metadata, "files_skipped") ? plural(num(metadata, "files_skipped"), "omitido", "omitidos") : null,
        num(metadata, "files_truncated") ? plural(num(metadata, "files_truncated"), "truncado", "truncados") : null,
        plural(num(metadata, "occurrences"), "ocurrencia", "ocurrencias"),
      ].filter(Boolean);
      return { title: `Lote ${num(metadata, "chunk_index") + 1} procesado`, detail: parts.join(" · ") };
    }
    case "github_metadata": {
      const commit = text(metadata, "commit");
      return {
        title: "Repositorio resuelto",
        detail: [
          `${text(metadata, "owner") ?? "?"}/${text(metadata, "repo") ?? "?"}`,
          text(metadata, "branch") ? `rama ${text(metadata, "branch")}` : null,
          commit ? `commit ${commit.slice(0, 7)}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    }
    case "github_truncated":
      return {
        title: "Análisis detenido antes de terminar",
        detail:
          text(metadata, "reason") === "time_guard"
            ? "Se alcanzó la guarda de tiempo (~240 s)."
            : "El repositorio supera el tamaño máximo (50 MB).",
      };
    case "scan_completed": {
      const parts = [
        field(metadata, "is_full_scan") === true ? "cobertura completa" : "cobertura parcial",
        plural(num(metadata, "findings_new"), "hallazgo nuevo", "hallazgos nuevos"),
        num(metadata, "findings_reopened") ? plural(num(metadata, "findings_reopened"), "reabierto", "reabiertos") : null,
        num(metadata, "auto_resolved") ? plural(num(metadata, "auto_resolved"), "resuelto automáticamente", "resueltos automáticamente") : null,
      ].filter(Boolean);
      return { title: "Escaneo completado", detail: parts.join(" · ") };
    }
    case "scan_failed": {
      const reason = text(metadata, "reason");
      return { title: "Escaneo fallido", detail: reason ? (SCAN_ERROR_LABELS[reason] ?? reason) : null };
    }
    default:
      return { title: event, detail: null };
  }
}

export interface TtrSummaryRow {
  severity: Severity | null;
  resolved_count: number | null;
  avg_ttr_seconds: number | null;
}

export interface TtrBySeverity {
  severity: Severity;
  resolved: number;
  avgSeconds: number | null;
}

/**
 * TTR por severidad sumando todos los proyectos (la vista lo da por proyecto):
 * promedio ponderado por número de hallazgos resueltos.
 */
export function ttrBySeverity(rows: readonly TtrSummaryRow[]): TtrBySeverity[] {
  return SEVERITY_ORDER.map((severity) => {
    let resolved = 0;
    let weighted = 0;
    for (const r of rows) {
      if (r.severity !== severity || !r.resolved_count || r.avg_ttr_seconds === null) continue;
      resolved += r.resolved_count;
      weighted += r.resolved_count * r.avg_ttr_seconds;
    }
    return { severity, resolved, avgSeconds: resolved > 0 ? Math.round(weighted / resolved) : null };
  });
}

export interface AlertLogRow {
  scan_id: string | null;
  attempt: number;
  success: boolean;
  created_at: string;
}

export interface AlertDeliveryStats {
  /** Envíos: un escaneo (o prueba) cuenta una vez aunque tenga varios intentos. */
  deliveries: number;
  delivered: number;
  failed: number;
  attempts: number;
}

/** Resume los intentos de `alert_logs` en entregas exitosas y fallidas. */
export function alertDeliveryStats(rows: readonly AlertLogRow[]): AlertDeliveryStats {
  const byScan = new Map<string, boolean>();
  rows.forEach((r, i) => {
    const key = r.scan_id ?? `sin-escaneo-${i}`;
    byScan.set(key, (byScan.get(key) ?? false) || r.success);
  });
  const delivered = [...byScan.values()].filter(Boolean).length;
  return { deliveries: byScan.size, delivered, failed: byScan.size - delivered, attempts: rows.length };
}
