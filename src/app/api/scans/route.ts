import { jsonError, jsonOk, logInternalError, readJsonBody } from "@/lib/api/http";
import { createScan } from "@/lib/scans/create";
import { SupabaseScanStore } from "@/lib/scans/persist";
import { createScanSchema } from "@/lib/scans/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";

const MAX_BODY_BYTES = 16 * 1024;

/** POST /api/scans: crea un escaneo (`queued`) para un proyecto del usuario. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthorized", "Inicia sesión para continuar.");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = createScanSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Petición inválida.");
  }
  if (parsed.data.ingest === "github") {
    // Se habilita en el checkpoint 13 (procesamiento en el servidor).
    return jsonError(501, "github_not_available", "El escaneo de GitHub aún no está disponible.");
  }

  try {
    const store = new SupabaseScanStore(createSupabaseAdminClient());
    const result = await createScan(store, user.id, parsed.data, new Date());
    if (!result.ok) {
      switch (result.error) {
        case "project_not_found":
          return jsonError(404, result.error, "El proyecto no existe.");
        case "hourly_limit":
          return jsonError(429, result.error, "Alcanzaste el límite de escaneos por hora.");
        case "concurrent_limit":
          return jsonError(429, result.error, "Ya tienes el máximo de escaneos en curso.");
      }
    }
    return jsonOk({ scan_id: result.scan.id, status: result.scan.status }, 201);
  } catch (error) {
    logInternalError("api/scans", error);
    return jsonError(500, "internal_error", "No se pudo crear el escaneo.");
  }
}
