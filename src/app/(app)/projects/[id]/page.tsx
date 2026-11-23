import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { ScanTable } from "@/components/scans/scan-table";
import { DeleteProjectButton } from "@/components/projects/delete-project-button";
import { ProjectForm } from "@/components/projects/project-form";
import { ScoreMeter } from "@/components/projects/score-meter";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SeverityBadge } from "@/components/ui/severity-badge";
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
          <ScanTable scans={scans} />
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
