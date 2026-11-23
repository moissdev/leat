import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getSupabasePublicEnv, requireEnv } from "./env";

/**
 * Cliente de Supabase con `service_role`: OMITE RLS.
 *
 * Reglas de uso (CLAUDE.md, "Acceso a datos y seguridad"):
 * - Solo en módulos de servidor; `server-only` rompe el build si llega al cliente.
 * - El `user_id` sale SIEMPRE de la sesión verificada, nunca del body.
 * - Toda consulta filtra explícitamente por `user_id`.
 */
export function createSupabaseAdminClient() {
  const { url } = getSupabasePublicEnv();
  const serviceRoleKey = requireEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
