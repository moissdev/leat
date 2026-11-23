import { describe, expect, it } from "vitest";
import { alertDeliveryStats, describeScanLog, ttrBySeverity } from "@/lib/reports/summaries";

describe("describeScanLog", () => {
  it.each([
    ["scan_created", {}, "Escaneo creado", null],
    [
      "chunk_processed",
      { chunk_index: 0, files_scanned: 3, files_skipped: 1, files_truncated: 0, occurrences: 2 },
      "Lote 1 procesado",
      "3 archivos analizados · 1 omitido · 2 ocurrencias",
    ],
    [
      "github_metadata",
      { owner: "octocat", repo: "Spoon-Knife", branch: "main", commit: "d0dd1f61b33d64e29d8bc1372a94ef6a2fee76a9" },
      "Repositorio resuelto",
      "octocat/Spoon-Knife · rama main · commit d0dd1f6",
    ],
    ["github_truncated", { reason: "time_guard" }, "Análisis detenido antes de terminar", "Se alcanzó la guarda de tiempo (~240 s)."],
    [
      "scan_completed",
      { is_full_scan: true, findings_new: 1, findings_reopened: 0, auto_resolved: 2 },
      "Escaneo completado",
      "cobertura completa · 1 hallazgo nuevo · 2 resueltos automáticamente",
    ],
    ["scan_failed", { reason: "repo_not_found" }, "Escaneo fallido", "El repositorio no existe o no es accesible"],
    ["evento_desconocido", null, "evento_desconocido", null],
  ])("%s", (event, metadata, title, detail) => {
    expect(describeScanLog(event, metadata)).toEqual({ title, detail });
  });

  it("tolera metadatos malformados", () => {
    expect(describeScanLog("chunk_processed", ["no", "objeto"]).title).toBe("Lote 1 procesado");
  });
});

describe("ttrBySeverity", () => {
  it("pondera por resueltos sumando proyectos y respeta el orden de severidad", () => {
    expect(
      ttrBySeverity([
        { severity: "high", resolved_count: 1, avg_ttr_seconds: 100 },
        { severity: "high", resolved_count: 3, avg_ttr_seconds: 300 },
        { severity: "critical", resolved_count: 2, avg_ttr_seconds: 60 },
      ]),
    ).toEqual([
      { severity: "critical", resolved: 2, avgSeconds: 60 },
      { severity: "high", resolved: 4, avgSeconds: 250 },
      { severity: "medium", resolved: 0, avgSeconds: null },
      { severity: "low", resolved: 0, avgSeconds: null },
    ]);
  });
});

describe("alertDeliveryStats", () => {
  it("un escaneo con reintentos cuenta como una entrega; exitosa si algún intento lo fue", () => {
    const at = "2026-01-01T00:00:00Z";
    expect(
      alertDeliveryStats([
        { scan_id: "a", attempt: 1, success: false, created_at: at },
        { scan_id: "a", attempt: 2, success: true, created_at: at },
        { scan_id: "b", attempt: 1, success: false, created_at: at },
        { scan_id: "b", attempt: 2, success: false, created_at: at },
        { scan_id: "c", attempt: 1, success: true, created_at: at },
      ]),
    ).toEqual({ deliveries: 3, delivered: 2, failed: 1, attempts: 5 });
  });

  it("sin intentos", () => {
    expect(alertDeliveryStats([])).toEqual({ deliveries: 0, delivered: 0, failed: 0, attempts: 0 });
  });
});
