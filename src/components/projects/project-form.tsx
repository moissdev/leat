"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, TextField } from "@/components/ui/text-field";
import { createProject, updateProject, type ProjectFormState } from "@/lib/projects/actions";

interface ProjectFormProps {
  /** Con `projectId` edita; sin él, crea. */
  projectId?: string;
  initial?: { name: string; repo_url: string };
}

export function ProjectForm({ projectId, initial }: ProjectFormProps) {
  const action = projectId ? updateProject : createProject;
  const [state, formAction, pending] = useActionState<ProjectFormState, FormData>(action, {});
  const values = state.values ?? initial ?? { name: "", repo_url: "" };

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {projectId ? <input type="hidden" name="id" value={projectId} /> : null}
      {state.error ? <FormMessage kind="error">{state.error}</FormMessage> : null}
      {state.saved ? <FormMessage kind="success">Cambios guardados</FormMessage> : null}

      <TextField
        name="name"
        label="Nombre"
        placeholder="api-pagos"
        maxLength={80}
        required
        defaultValue={values.name}
        error={state.fieldErrors?.name}
      />
      <TextField
        name="repo_url"
        label="Repositorio de GitHub (opcional)"
        placeholder="https://github.com/usuario/repositorio"
        hint="Solo repositorios públicos. Se usa para precargar los escaneos de GitHub."
        defaultValue={values.repo_url}
        error={state.fieldErrors?.repo_url}
      />

      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Guardando…" : projectId ? "Guardar cambios" : "Crear proyecto"}
        </Button>
      </div>
    </form>
  );
}
