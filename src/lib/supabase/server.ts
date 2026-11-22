import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { getSupabasePublicEnv } from "./env";

/**
 * Cliente de Supabase para componentes de servidor, Server Actions y Route Handlers.
 * Actúa con la sesión del usuario (cookies), así que todas las consultas pasan por RLS.
 * Crear uno nuevo por request; no compartirlo entre usuarios.
 */
export async function createSupabaseServerClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Desde un Server Component no se pueden escribir cookies; el proxy
          // (src/proxy.ts, checkpoint 3) se encarga de refrescar la sesión.
        }
      },
    },
  });
}
