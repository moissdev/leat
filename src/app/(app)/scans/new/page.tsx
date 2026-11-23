import type { Metadata } from "next";
import { FolderGit2 } from "lucide-react";
import { NewScanForm } from "@/components/scans/new-scan-form";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { listProjects } from "@/lib/projects/queries";

export const metadata: Metadata = { title: "Nuevo escaneo · LEAT" };

export default async function NewScanPage({ searchParams }: PageProps<"/scans/new">) {
  const [{ project }, projects] = await Promise.all([searchParams, listProjects()]);
  const defaultProjectId = typeof project === "string" && projects.some((p) => p.id === project) ? project : undefined;

  return (
    <>
      <PageHeader
        title="Nuevo escaneo"
        description="Analiza un fragmento, un archivo, un ZIP o un repositorio público de GitHub."
      />
      {projects.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <FolderGit2 className="size-8 text-fg-subtle" aria-hidden="true" />
          <p className="font-medium text-fg">Primero crea un proyecto</p>
          <p className="max-w-sm text-sm text-fg-muted">Cada escaneo pertenece a un proyecto.</p>
          <ButtonLink href="/projects" variant="primary">
            Crear proyecto
          </ButtonLink>
        </Card>
      ) : (
        <Card className="max-w-3xl">
          <NewScanForm
            defaultProjectId={defaultProjectId}
            projects={projects.map((p) => ({
              id: p.id,
              name: p.name,
              repoUrl: p.githubOwner ? `https://github.com/${p.githubOwner}/${p.githubRepo}` : null,
            }))}
          />
        </Card>
      )}
    </>
  );
}
