"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { projectFormSchema, projectIdSchema } from "./schemas";

/**
 * Acciones de proyectos con el cliente de la SESIÓN (RLS): el `user_id` lo
 * pone la base de datos (`default auth.uid()`) y las políticas impiden tocar
 * proyectos ajenos. Nunca se usa `service_role` aquí.
 */

export interface ProjectFormState {
  error?: string;
  saved?: boolean;
  fieldErrors?: Partial<Record<"name" | "repo_url", string>>;
  values?: { name: string; repo_url: string };
}

const UNIQUE_VIOLATION = "23505";

function read(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function parseForm(formData: FormData) {
  const values = { name: read(formData, "name"), repo_url: read(formData, "repo_url") };
  return { values, parsed: projectFormSchema.safeParse(values) };
}

function fieldErrors(error: z.ZodError): ProjectFormState["fieldErrors"] {
  const flat = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  return { name: flat.name?.[0], repo_url: flat.repo_url?.[0] };
}

export async function createProject(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  if (!(await getSessionUser())) redirect("/login");
  const { values, parsed } = parseForm(formData);
  if (!parsed.success) return { values, fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({
      name: parsed.data.name,
      github_owner: parsed.data.github?.owner ?? null,
      github_repo: parsed.data.github?.repo ?? null,
    })
    .select("id")
    .single();

  if (error?.code === UNIQUE_VIOLATION) {
    return { values, fieldErrors: { name: "Ya tienes un proyecto con ese nombre." } };
  }
  if (error || !data) return { values, error: "No se pudo crear el proyecto. Intenta de nuevo." };

  revalidatePath("/projects");
  redirect(`/projects/${data.id}`);
}

export async function updateProject(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  if (!(await getSessionUser())) redirect("/login");
  const id = projectIdSchema.safeParse(read(formData, "id"));
  const { values, parsed } = parseForm(formData);
  if (!id.success) return { values, error: "Proyecto no válido." };
  if (!parsed.success) return { values, fieldErrors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("projects")
    .update({
      name: parsed.data.name,
      github_owner: parsed.data.github?.owner ?? null,
      github_repo: parsed.data.github?.repo ?? null,
    })
    .eq("id", id.data)
    .select("id");

  if (error?.code === UNIQUE_VIOLATION) {
    return { values, fieldErrors: { name: "Ya tienes un proyecto con ese nombre." } };
  }
  if (error || !data?.length) return { values, error: "No se pudo guardar el proyecto." };

  revalidatePath("/projects");
  revalidatePath(`/projects/${id.data}`);
  return { values, saved: true };
}

/** Elimina el proyecto y, en cascada, sus escaneos, hallazgos y registros. */
export async function deleteProject(formData: FormData): Promise<void> {
  if (!(await getSessionUser())) redirect("/login");
  const id = projectIdSchema.safeParse(read(formData, "id"));
  if (id.success) {
    const supabase = await createSupabaseServerClient();
    await supabase.from("projects").delete().eq("id", id.data);
    revalidatePath("/projects");
  }
  redirect("/projects");
}
