import Link from "next/link";
import { ScanStatusBadge } from "@/components/scans/scan-status-badge";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { INGEST_LABELS } from "@/lib/i18n/labels";
import type { Tables } from "@/types/database";

/** Tabla de escaneos (detalle de proyecto e historial de informes). */
export function ScanTable({ scans, showProject = false }: { scans: Tables<"scan_report_v">[]; showProject?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="text-left text-xs text-fg-subtle">
            <th className="pb-2 font-normal">Fecha</th>
            {showProject ? <th className="pb-2 font-normal">Proyecto</th> : null}
            <th className="pb-2 font-normal">Origen</th>
            <th className="pb-2 font-normal">Estado</th>
            <th className="pb-2 font-normal">Archivos</th>
            <th className="pb-2 font-normal">Nuevos</th>
            <th className="pb-2 font-normal">Reabiertos</th>
            <th className="pb-2 font-normal">Duración</th>
          </tr>
        </thead>
        <tbody>
          {scans.map((scan) => (
            <tr key={scan.id} className="border-t border-line">
              <td className="py-2.5">
                <Link href={`/scans/${scan.id}`} className="text-accent hover:underline">
                  {formatDateTime(scan.created_at)}
                </Link>
              </td>
              {showProject ? <td className="py-2.5 text-fg">{scan.project_name}</td> : null}
              <td className="py-2.5 text-fg-muted">{scan.ingest ? INGEST_LABELS[scan.ingest] : "—"}</td>
              <td className="py-2.5">{scan.status ? <ScanStatusBadge status={scan.status} /> : null}</td>
              <td className="py-2.5 text-fg-muted tabular-nums">
                {formatNumber(scan.files_scanned)}
                {scan.is_full_scan === false && scan.status === "completed" ? (
                  <span className="ml-1 text-xs text-sev-medium-fg">(parcial)</span>
                ) : null}
              </td>
              <td className="py-2.5 text-fg tabular-nums">{formatNumber(scan.findings_new)}</td>
              <td className="py-2.5 text-fg-muted tabular-nums">{formatNumber(scan.findings_reopened)}</td>
              <td className="py-2.5 text-fg-muted">{formatDuration(scan.duration_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
