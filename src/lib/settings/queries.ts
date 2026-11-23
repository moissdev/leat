import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AlertSettings {
  webhookConfigured: boolean;
  alertsEnabled: boolean;
  updatedAt: string | null;
}

/**
 * Configuración de alertas con la sesión del usuario. RLS y los GRANT por
 * columna solo dejan leer `webhook_configured`, `alerts_enabled` y
 * `updated_at`: el webhook cifrado nunca es legible desde el cliente.
 */
export async function getAlertSettings(): Promise<AlertSettings> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("user_settings")
    .select("webhook_configured, alerts_enabled, updated_at")
    .maybeSingle();
  return {
    webhookConfigured: data?.webhook_configured ?? false,
    alertsEnabled: data?.alerts_enabled ?? true,
    updatedAt: data?.updated_at ?? null,
  };
}
