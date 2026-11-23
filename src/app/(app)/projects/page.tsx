import type { Metadata } from "next";
import Link from "next/link";
import { FolderGit2 } from "lucide-react";
import { ProjectForm } from "@/components/projects/project-form";
import { ScoreMeter } from "@/components/projects/score-meter";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { listProjects, type ProjectSummary } from "@/lib/projects/queries";

export const metadata: Metadata = { title: "Proyectos · LEAT" };

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <>
      <PageHeader title="Proyectos" description="Agrupa tus escaneos por proyecto. Cada uno tiene su propio score." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-3">
          {projects.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 py-10 text-center">
              <FolderGit2 className="size-8 text-fg-subtle" aria-hidden="true" />
              <p className="font-medium text-fg">Crea tu primer proyecto</p>
              <p className="max-w-sm text-sm text-fg-muted">
                Un proyecto agrupa los escaneos de un mismo código para seguir sus hallazgos en el tiempo.
              </p>
            </Card>
          ) : (
            projects.map((project) => <ProjectCard key={project.id} project={project} />)
          )}
        </div>

        <Card className="h-fit">
          <CardTitle>Nuevo proyecto</CardTitle>
          <ProjectForm />
        </Card>
      </div>
    </>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const counts = [
    ["critical", project.activeCritical],
    ["high", project.activeHigh],
    ["medium", project.activeMedium],
    ["low", project.activeLow],
  ] as const;

  return (
    <Link
      href={`/projects/${project.id}`}
      className="grid gap-4 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-strong sm:grid-cols-[minmax(0,1fr)_160px]"
    >
      <div className="min-w-0">
        <p className="truncate font-medium text-fg">{project.name}</p>
        <p className="truncate text-xs text-fg-subtle">
          {project.githubOwner ? `github.com/${project.githubOwner}/${project.githubRepo}` : "Sin repositorio vinculado"}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {counts.some(([, n]) => n > 0) ? (
            counts
              .filter(([, n]) => n > 0)
              .map(([severity, n]) => (
                <span key={severity} className="inline-flex items-center gap-1 text-xs text-fg-muted">
                  <SeverityBadge severity={severity} /> {n}
                </span>
              ))
          ) : (
            <span className="text-xs text-fg-muted">Sin hallazgos activos</span>
          )}
        </div>
      </div>
      <ScoreMeter score={project.score} size="sm" />
    </Link>
  );
}
