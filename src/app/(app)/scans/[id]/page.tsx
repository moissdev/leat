import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { LiveScanProgress } from "@/components/scans/live-scan-progress";
import { Card, CardTitle } from "@/components/ui/card";
import { MaskedValue } from "@/components/ui/masked-value";
import { PageHeader } from "@/components/ui/page-header";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime, formatDuration } from "@/lib/format";
import { INGEST_LABELS, SEVERITY_ORDER, secretTypeLabel } from "@/lib/i18n/labels";
import { getScanReport, listScanOccurrences } from "@/lib/projects/queries";
import { projectIdSchema } from "@/lib/projects/schemas";

export const metadata: Metadata = { title: "Escaneo · LEAT" };

export default async function ScanPage({ params }: PageProps<"/scans/[id]">) {
  const { id } = await params;
  if (!projectIdSchema.safeParse(id).success) notFound();

  const scan = await getScanReport(id);
  if (!scan?.id || !scan.status || !scan.ingest) notFound();
  const occurrences = scan.status === "completed" ? await listScanOccurrences(id) : [];
  const sorted = [...occurrences].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.finding.severity) - SEVERITY_ORDER.indexOf(b.finding.severity),
  );

  const origin = scan.ingest === "github" && scan.source_ref ? `commit ${scan.source_ref.slice(0, 7)}` : scan.source_ref;

  return (
    <>
      <PageHeader
        title={`Escaneo de ${INGEST_LABELS[scan.ingest].toLowerCase()}`}
        description={[
          scan.project_name ? `Proyecto ${scan.project_name}` : null,
          origin,
          formatDateTime(scan.created_at),
          scan.duration_ms !== null ? `duró ${formatDuration(scan.duration_ms)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          scan.project_id ? (
            <Link href={`/projects/${scan.project_id}`} className="text-sm text-accent hover:underline">
              Ver proyecto
            </Link>
          ) : null
        }
      />

      <LiveScanProgress
        initial={{
          id: scan.id,
          status: scan.status,
          files_total: scan.files_total ?? 0,
          files_scanned: scan.files_scanned ?? 0,
          files_skipped: scan.files_skipped ?? 0,
          files_truncated: scan.files_truncated ?? 0,
          bytes_scanned: scan.bytes_scanned ?? 0,
          chunks_received: 0,
          occurrences_total: scan.occurrences_total ?? 0,
          findings_new: scan.findings_new ?? 0,
          findings_reopened: scan.findings_reopened ?? 0,
          is_full_scan: scan.is_full_scan ?? false,
          error_message: scan.error_message,
        }}
      />

      {scan.status === "completed" ? (
        <Card className="mt-4">
          <CardTitle>Secretos detectados ({sorted.length})</CardTitle>
          {sorted.length === 0 ? (
            <div className="flex items-center gap-3 py-4 text-sm text-status-resolved-fg">
              <ShieldCheck className="size-5" aria-hidden="true" />
              No se detectaron secretos en este escaneo.
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {sorted.map((o) => (
                <li key={`${o.finding.id}-${o.filePath}-${o.lineNumber}`} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <SeverityBadge severity={o.finding.severity} />
                    <Link href={`/findings/${o.finding.id}`} className="text-sm font-medium text-fg hover:text-accent">
                      {secretTypeLabel(o.finding.secret_type)}
                    </Link>
                    <MaskedValue value={o.finding.masked_value} />
                    <StatusBadge status={o.finding.status} className="ml-auto" />
                  </div>
                  <p className="text-xs text-fg-subtle">
                    {o.filePath}:{o.lineNumber}
                  </p>
                  <pre className="overflow-x-auto rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-fg-muted">
                    {o.maskedContext}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </>
  );
}
