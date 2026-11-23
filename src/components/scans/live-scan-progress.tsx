"use client";

import { Loader2 } from "lucide-react";
import { ScanStatusBadge } from "@/components/scans/scan-status-badge";
import { Card } from "@/components/ui/card";
import { useScanProgress, type ScanProgressRow } from "@/hooks/use-scan-progress";
import { formatBytes, formatNumber } from "@/lib/format";
import { SCAN_ERROR_LABELS } from "@/lib/i18n/labels";

/** Tarjeta de progreso en vivo de un escaneo. */
export function LiveScanProgress({ initial }: { initial: ScanProgressRow }) {
  const scan = useScanProgress(initial);
  const running = scan.status === "queued" || scan.status === "running";

  const stats: [string, string][] = [
    ["Archivos analizados", formatNumber(scan.files_scanned)],
    ["Omitidos", formatNumber(scan.files_skipped)],
    ["Truncados", formatNumber(scan.files_truncated)],
    ["Texto analizado", formatBytes(scan.bytes_scanned)],
    ["Ocurrencias", formatNumber(scan.occurrences_total)],
    ["Hallazgos nuevos", formatNumber(scan.findings_new)],
  ];

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ScanStatusBadge status={scan.status} />
          {running ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Analizando; esta vista se actualiza sola.
            </span>
          ) : null}
        </div>
        {scan.status === "completed" ? (
          <span className={scan.is_full_scan ? "text-xs text-status-resolved-fg" : "text-xs text-sev-medium-fg"}>
            {scan.is_full_scan ? "Cobertura completa" : "Cobertura parcial: se omitieron archivos por límites"}
          </span>
        ) : null}
      </div>

      {scan.status === "failed" ? (
        <p className="mb-4 rounded-lg border border-threat/60 bg-threat/15 px-3 py-2 text-sm text-threat-fg">
          {SCAN_ERROR_LABELS[scan.error_message ?? ""] ?? "El escaneo falló."}
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-fg-subtle">{label}</dt>
            <dd className="text-lg font-semibold text-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
