import type { Metadata } from "next";
import Link from "next/link";
import { AlertLogTable } from "@/components/reports/alert-log-table";
import { ScanTable } from "@/components/scans/scan-table";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { MaskedValue } from "@/components/ui/masked-value";
import { PageHeader } from "@/components/ui/page-header";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { listProjectOptions } from "@/lib/findings/queries";
import { formatDateTime, formatNumber, formatTtr } from "@/lib/format";
import {
  INGEST_LABELS,
  lifecycleReasonLabel,
  SCAN_STATUS_LABELS,
  secretTypeLabel,
  type IngestType,
  type ScanStatus,
} from "@/lib/i18n/labels";
import {
  getTtrRows,
  listAlertLogs,
  listRecentTransitions,
  listScanHistory,
  REPORT_PAGE_SIZE,
  scanHistoryFiltersSchema,
  type ScanHistoryFilters,
} from "@/lib/reports/queries";
import { alertDeliveryStats, ttrBySeverity } from "@/lib/reports/summaries";
import { failOrphanScans } from "@/lib/scans/cleanup";
import { SupabaseScanStore } from "@/lib/scans/persist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/session";

export const metadata: Metadata = { title: "Informes · LEAT" };

const selectClasses = "h-9 min-w-36 rounded-lg border border-line bg-raised px-2 text-sm text-fg focus:border-accent focus:outline-none";

function pageHref(filters: ScanHistoryFilters, page: number): string {
  const params = new URLSearchParams();
  for (const key of ["project", "ingest", "status"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/reports?${query}` : "/reports";
}

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const filters = scanHistoryFiltersSchema.parse(await searchParams);

  // Limpieza perezosa de escaneos huérfanos antes de listar (decisiones, sección 3.1).
  const user = await requireUser();
  await failOrphanScans(new SupabaseScanStore(createSupabaseAdminClient()), user.id, new Date());

  const [history, projects, ttrRows, alerts, transitions] = await Promise.all([
    listScanHistory(filters),
    listProjectOptions(),
    getTtrRows(),
    listAlertLogs({ limit: 50 }),
    listRecentTransitions(20),
  ]);
  const pages = Math.max(1, Math.ceil(history.total / REPORT_PAGE_SIZE));
  const ttr = ttrBySeverity(ttrRows);
  const delivery = alertDeliveryStats(alerts);

  return (
    <>
      <PageHeader
        title="Informes"
        description="Historial de escaneos, tiempos de remediación, entregas de alertas y actividad de auditoría."
      />

      <Card>
        <CardTitle>Historial de escaneos ({formatNumber(history.total)})</CardTitle>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filtros del historial">
          <label className="flex flex-col gap-1 text-xs text-fg-subtle">
            Proyecto
            <select name="project" defaultValue={filters.project ?? ""} className={selectClasses}>
              <option value="">Todos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-subtle">
            Origen
            <select name="ingest" defaultValue={filters.ingest ?? ""} className={selectClasses}>
              <option value="">Todos</option>
              {(Object.keys(INGEST_LABELS) as IngestType[]).map((k) => (
                <option key={k} value={k}>
                  {INGEST_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-subtle">
            Estado
            <select name="status" defaultValue={filters.status ?? ""} className={selectClasses}>
              <option value="">Todos</option>
              {(Object.keys(SCAN_STATUS_LABELS) as ScanStatus[]).map((k) => (
                <option key={k} value={k}>
                  {SCAN_STATUS_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={buttonClasses("secondary", "sm", "h-9")}>
            Filtrar
          </button>
        </form>
        {history.items.length === 0 ? (
          <p className="text-sm text-fg-muted">Sin escaneos con estos filtros.</p>
        ) : (
          <ScanTable scans={history.items} showProject />
        )}
        {pages > 1 ? (
          <nav aria-label="Paginación del historial" className="mt-3 flex items-center justify-between text-sm text-fg-muted">
            <span>
              Página {filters.page} de {pages}
            </span>
            <div className="flex gap-3">
              {filters.page > 1 ? (
                <Link href={pageHref(filters, filters.page - 1)} className="text-accent hover:underline">
                  Anterior
                </Link>
              ) : null}
              {filters.page < pages ? (
                <Link href={pageHref(filters, filters.page + 1)} className="text-accent hover:underline">
                  Siguiente
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardTitle>Tiempo medio de remediación (TTR)</CardTitle>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-fg-subtle">
                <th className="pb-2 font-normal">Severidad</th>
                <th className="pb-2 font-normal">Resueltos</th>
                <th className="pb-2 font-normal">TTR medio</th>
              </tr>
            </thead>
            <tbody>
              {ttr.map((row) => (
                <tr key={row.severity} className="border-t border-line">
                  <td className="py-2.5">
                    <SeverityBadge severity={row.severity} />
                  </td>
                  <td className="py-2.5 text-fg tabular-nums">{formatNumber(row.resolved)}</td>
                  <td className="py-2.5 text-fg">{formatTtr(row.avgSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-fg-subtle">
            Desde la primera detección hasta que se resolvió (manual o automáticamente).
          </p>
        </Card>

        <Card>
          <CardTitle>Entregas de alertas a Discord</CardTitle>
          <dl className="mb-4 grid grid-cols-3 gap-3">
            {[
              ["Entregadas", delivery.delivered, "text-status-resolved-fg"],
              ["Fallidas", delivery.failed, delivery.failed > 0 ? "text-status-active-fg" : "text-fg"],
              ["Intentos", delivery.attempts, "text-fg"],
            ].map(([label, value, color]) => (
              <div key={String(label)}>
                <dt className="text-xs text-fg-subtle">{label}</dt>
                <dd className={`text-2xl font-semibold tabular-nums ${String(color)}`}>{formatNumber(Number(value))}</dd>
              </div>
            ))}
          </dl>
          <AlertLogTable logs={alerts.slice(0, 15)} />
          <p className="mt-3 text-xs text-fg-subtle">Últimos 50 intentos; un escaneo puede tener varios por reintentos.</p>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>Actividad reciente de hallazgos</CardTitle>
        {transitions.length === 0 ? (
          <p className="text-sm text-fg-muted">Sin actividad.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-fg-subtle">
                  <th className="pb-2 font-normal">Fecha</th>
                  <th className="pb-2 font-normal">Hallazgo</th>
                  <th className="pb-2 font-normal">Transición</th>
                  <th className="pb-2 font-normal">Actor</th>
                  <th className="pb-2 font-normal">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {transitions.map((t) => (
                  <tr key={t.id} className="border-t border-line align-top">
                    <td className="py-2.5 whitespace-nowrap text-fg-muted">{formatDateTime(t.createdAt)}</td>
                    <td className="py-2.5">
                      <Link href={`/findings/${t.findingId}`} className="text-fg hover:text-accent">
                        {secretTypeLabel(t.secretType)}
                      </Link>{" "}
                      <MaskedValue value={t.maskedValue} />
                    </td>
                    <td className="py-2.5">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {t.from ? (
                          <>
                            <StatusBadge status={t.from} />
                            <span className="text-fg-subtle">→</span>
                          </>
                        ) : null}
                        <StatusBadge status={t.to} />
                      </span>
                    </td>
                    <td className="py-2.5 text-fg-muted">{t.actor === "system" ? "Sistema" : "Tú"}</td>
                    <td className="py-2.5 break-words text-fg-muted">
                      {t.reason ? lifecycleReasonLabel(t.reason) : "—"}
                      {t.ttrSeconds !== null ? (
                        <span className="text-xs text-fg-subtle"> · TTR {formatTtr(t.ttrSeconds)}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
