/**
 * Integración con el Supabase de desarrollo (solo lectura; no crea ni borra datos).
 * Se ejecuta con `npm run test:db`. Nunca imprime claves ni valores de entorno.
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";

const TABLES = [
  "user_settings",
  "projects",
  "scans",
  "findings",
  "finding_occurrences",
  "scan_logs",
  "vulnerability_lifecycle_logs",
  "alert_logs",
] as const;

const VIEWS = ["scan_report_v", "project_score_v", "ttr_summary_v"] as const;

/** Cliente con la clave anónima y sin sesión: equivale a un visitante no autenticado. */
function anonClient() {
  const { url, anonKey } = getSupabasePublicEnv();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe("cliente admin (service_role)", () => {
  const admin = createSupabaseAdminClient();

  // Se exige status 200 y un conteo numérico: un HEAD con 404 no trae cuerpo
  // y deja `error` en null, lo que daría un falso positivo.
  it.each(TABLES)("lee la tabla %s", async (table) => {
    const { error, status, count } = await admin
      .from(table)
      .select("*", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(status).toBe(200);
    expect(typeof count).toBe("number");
  });

  it.each(VIEWS)("lee la vista %s", async (view) => {
    const { error, status, count } = await admin
      .from(view)
      .select("*", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(status).toBe(200);
    expect(typeof count).toBe("number");
  });
});

describe("rol anon (sin sesión)", () => {
  const anon = anonClient();

  it.each([...TABLES, ...VIEWS])("no puede leer %s", async (relation) => {
    const { data, error } = await anon.from(relation).select("*").limit(1);
    // Sin GRANT para anon: PostgREST responde "permission denied" (42501).
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("no puede insertar proyectos", async () => {
    const { error } = await anon.from("projects").insert({ name: "anon-intrusion" });
    expect(error?.code).toBe("42501");
  });

  it("no puede invocar la función de trigger por RPC (migración 002)", async () => {
    const { error, status } = await anon.rpc("fn_finding_audit");
    expect(error).not.toBeNull();
    // Debe ser un rechazo de permisos/ruta de la función, no un fallo de URL del proyecto.
    expect(error?.code).not.toBe("PGRST125");
    expect(status).not.toBe(200);
  });
});
