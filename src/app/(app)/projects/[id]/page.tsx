import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { DeleteProjectButton } from "@/components/projects/delete-project-button";
import { ProjectForm } from "@/components/projects/project-form";
import { ScoreMeter } from "@/components/projects/score-meter";
import { ScanStatusBadge } from "@/components/scans/scan-status-badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { INGEST_LABELS } from "@/lib/i18n/labels";
import { getProject, listProjectScans } from "@/lib/projects/queries";
import { projectIdSchema } from "@/lib/projects/schemas";
import { failOrphanScans } from "@/lib/scans/cleanup";
import { SupabaseScanStore } from "@/lib/scans/persist";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/supabase/session";

export const metadata: Metadata = { title: "Proyecto · LEAT" };

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  if (!projectIdSchema.safeParse(id).success) notFound();

  // Limpieza perezosa de escaneos huérfanos antes de listar (decisiones, sección 3.1).
  const user = await requireUser();
  await failOrphanScans(new SupabaseScanStore(createSupabaseAdminClient()), user.id, new Date());

  const [project, scans] = await Promise.all([getProject(id), listProjectScans(id)]);
  if (!project) notFound();

  const counts = [
    ["critical", project.activeCritical],
    ["high", project.activeHigh],
    ["medium", project.activeMedium],
    ["low", project.activeLow],
  ] as const;

  return (
    <>
      <PageHeader
        title={project.name}
        description={
          project.githubOwner ? `github.com/${project.githubOwner}/${project.githubRepo}` : "Sin repositorio vinculado"
        }
        action={
          <ButtonLink href={`/scans/new?project=${project.id}`} variant="primary">
            <Plus className="size-4" aria-hidden="true" />
            Nuevo escaneo
          </ButtonLink>
        }
      />

      <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
        <Card>
          <CardTitle>Score</CardTitle>
          <ScoreMeter score={project.score} />
        </Card>
        <Card>
          <CardTitle>Hallazgos activos por severidad</CardTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {counts.map(([severity, n]) => (
              <div key={severity} className="flex flex-col items-start gap-2">
                <SeverityBadge severity={severity} />
                <span className="text-2xl font-semibold text-fg">{n}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardTitle>Escaneos</CardTitle>
        {scans.length === 0 ? (
          <p className="text-sm text-fg-muted">Aún no hay escaneos. Empieza con «Nuevo escaneo».</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs text-fg-subtle">
                  <th className="pb-2 font-normal">Fecha</th>
                  <th className="pb-2 font-normal">Origen</th>
                  <th className="pb-2 font-normal">Estado</th>
                  <th className="pb-2 font-normal">Archivos</th>
                  <th className="pb-2 font-normal">Nuevos</th>
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
                    <td className="py-2.5 text-fg-muted">{scan.ingest ? INGEST_LABELS[scan.ingest] : "—"}</td>
                    <td className="py-2.5">{scan.status ? <ScanStatusBadge status={scan.status} /> : null}</td>
                    <td className="py-2.5 text-fg-muted">
                      {formatNumber(scan.files_scanned)}
                      {scan.is_full_scan === false && scan.status === "completed" ? (
                        <span className="ml-1 text-xs text-sev-medium-fg">(parcial)</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 text-fg">{formatNumber(scan.findings_new)}</td>
                    <td className="py-2.5 text-fg-muted">{formatDuration(scan.duration_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Editar proyecto</CardTitle>
          <ProjectForm
            projectId={project.id}
            initial={{
              name: project.name,
              repo_url: project.githubOwner ? `https://github.com/${project.githubOwner}/${project.githubRepo}` : "",
            }}
          />
        </Card>
        <Card className="h-fit border-threat/50">
          <CardTitle>Zona de peligro</CardTitle>
          <p className="mb-4 text-sm text-fg-muted">
            Eliminar el proyecto borra sus escaneos, hallazgos e historial de auditoría.
          </p>
          <DeleteProjectButton projectId={project.id} projectName={project.name} />
        </Card>
      </div>
    </>
  );
}
