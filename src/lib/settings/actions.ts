"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/session";

export interface ToggleAlertsState {
  error?: string;
}

/**
 * Activa o desactiva las alertas con la sesión del usuario: RLS solo le
 * permite actualizar `alerts_enabled` de su propia fila de `user_settings`.
 * La fila existe una vez que guarda un webhook.
 */
export async function setAlertsEnabled(_prev: ToggleAlertsState, formData: FormData): Promise<ToggleAlertsState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const enabled = formData.get("enabled") === "true";

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("user_settings")
    .update({ alerts_enabled: enabled })
    .eq("user_id", user.id)
    .select("alerts_enabled");

  if (error) return { error: "No se pudo actualizar la preferencia." };
  if (!data?.length) return { error: "Primero guarda un webhook." };

  revalidatePath("/settings");
  return {};
}
