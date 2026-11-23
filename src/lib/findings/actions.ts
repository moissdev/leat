"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";
import { statusChangeSchema } from "./schemas";

export interface StatusFormState {
  error?: string;
  noteError?: string;
  saved?: boolean;
}

function read(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Cambia el estado de un hallazgo con la sesión del usuario: RLS solo permite
 * tocar `status` y `status_note` de hallazgos propios. El trigger registra la
 * transición (actor `user`, la nota como motivo y el TTR si se resuelve).
 */
export async function updateFindingStatus(_prev: StatusFormState, formData: FormData): Promise<StatusFormState> {
  if (!(await getSessionUser())) redirect("/login");

  const parsed = statusChangeSchema.safeParse({
    id: read(formData, "id"),
    status: read(formData, "status"),
    note: read(formData, "note"),
  });
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    return flat.note ? { noteError: flat.note[0] } : { error: "Elige un estado válido." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("findings")
    .update({ status: parsed.data.status, status_note: parsed.data.note || null })
    .eq("id", parsed.data.id)
    .select("id");

  if (error || !data?.length) return { error: "No se pudo actualizar el estado." };

  revalidatePath(`/findings/${parsed.data.id}`);
  revalidatePath("/findings");
  return { saved: true };
}
