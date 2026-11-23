"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteProject } from "@/lib/projects/actions";

/** Elimina el proyecto tras confirmar (borra en cascada escaneos y hallazgos). */
export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  return (
    <form
      action={deleteProject}
      onSubmit={(event) => {
        const ok = window.confirm(
          `¿Eliminar «${projectName}»? Se borrarán sus escaneos, hallazgos e historial. No se puede deshacer.`,
        );
        if (!ok) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={projectId} />
      <Button type="submit" variant="danger" size="sm">
        <Trash2 className="size-4" aria-hidden="true" />
        Eliminar proyecto
      </Button>
    </form>
  );
}
