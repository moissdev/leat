import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { getSupabasePublicEnv } from "./env";

/**
 * Cliente de Supabase para componentes de cliente (`"use client"`).
 * Usa la clave anónima y la sesión del usuario guardada en cookies: todo pasa por RLS.
 */
export function createSupabaseBrowserClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  return createBrowserClient<Database>(url, anonKey);
}
