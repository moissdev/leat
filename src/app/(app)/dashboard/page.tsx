import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { FolderGit2, Plus } from "lucide-react";
import { SeverityBars } from "@/components/dashboard/severity-bars";
import { StatTile } from "@/components/dashboard/stat-tile";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { ScoreMeter } from "@/components/projects/score-meter";
import { ScanStatusBadge } from "@/components/scans/scan-status-badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getDashboardData, TREND_DAYS } from "@/lib/dashboard/queries";
import { formatDateTime, formatNumber } from "@/lib/format";
import { INGEST_LABELS } from "@/lib/i18n/labels";

export const metadata: Metadata = { title: "Dashboard · LEAT" };

/** TTR legible en horas o días. */
function formatTtr(seconds: number | null): string {
  if (seconds === null) return "—";
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

export default async function DashboardPage() {
  await connection();
  const data = await getDashboardData(new Date());
  const activeTotal = data.totals.critical + data.totals.high + data.totals.medium + data.totals.low;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Resumen de exposición de tus proyectos."
        action={
          <ButtonLink href="/scans/new" variant="primary">
            <Plus className="size-4" aria-hidden="true" />
            Nuevo escaneo
          </ButtonLink>
        }
      />

      {data.projectCount === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <FolderGit2 className="size-8 text-fg-subtle" aria-hidden="true" />
          <p className="font-medium text-fg">Empieza creando un proyecto</p>
          <p className="max-w-sm text-sm text-fg-muted">
            Luego escanea su código y aquí verás su score, los secretos activos y su evolución.
          </p>
          <ButtonLink href="/projects" variant="primary">
            Crear proyecto
          </ButtonLink>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label="Score global"
              value={String(data.globalScore ?? 100)}
              hint={`Promedio de ${data.projectCount} ${data.projectCount === 1 ? "proyecto" : "proyectos"}`}
              valueClassName="text-assess-fg"
            >
              <div className="mt-3 h-1.5 rounded-full bg-track">
                <div className="h-1.5 rounded-full bg-assess" style={{ width: `${data.globalScore ?? 100}%` }} />
              </div>
            </StatTile>
            <StatTile
              label="Críticos y altos activos"
              value={formatNumber(data.totals.critical + data.totals.high)}
              hint={`${formatNumber(data.totals.critical)} críticos · ${formatNumber(data.totals.high)} altos`}
              valueClassName={data.totals.critical > 0 ? "text-sev-critical-fg" : undefined}
            />
            <StatTile
              label="Escaneos"
              value={formatNumber(data.scansLast30Days)}
              hint={`Últimos ${TREND_DAYS} días`}
              valueClassName="text-accent"
            />
            <StatTile label="TTR medio" value={formatTtr(data.meanTtrSeconds)} hint="Tiempo hasta resolver un hallazgo" />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <Card>
              <CardTitle>Activos por severidad ({formatNumber(activeTotal)})</CardTitle>
              <SeverityBars totals={data.totals} />
            </Card>
            <Card>
              <CardTitle>Detectados y resueltos, últimos {TREND_DAYS} días</CardTitle>
              <TrendChart data={data.trend} />
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardTitle>Proyectos con menor score</CardTitle>
              <ul className="flex flex-col divide-y divide-line">
                {data.atRisk.map((p) => (
                  <li key={p.project_id}>
                    <Link
                      href={`/projects/${p.project_id}`}
                      className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-4 py-2.5 hover:text-accent"
                    >
                      <span className="truncate text-sm text-fg">{p.project_name}</span>
                      <ScoreMeter score={p.score ?? 100} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardTitle>Escaneos recientes</CardTitle>
              {data.recentScans.length === 0 ? (
                <p className="text-sm text-fg-muted">Aún no hay escaneos.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {data.recentScans.map((s) => (
                    <li key={s.id}>
                      <Link href={`/scans/${s.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                        <span className="text-sm text-fg">{s.project_name}</span>
                        <span className="text-xs text-fg-subtle">{s.ingest ? INGEST_LABELS[s.ingest] : ""}</span>
                        {s.status ? <ScanStatusBadge status={s.status} /> : null}
                        <span className="ml-auto text-xs text-fg-subtle">{formatDateTime(s.created_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
