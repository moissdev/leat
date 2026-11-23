import { z } from "zod";
import { jsonError, jsonOk, logInternalError, readJsonBody } from "@/lib/api/http";
import { ZIP_LIMITS } from "@/lib/config";
import { processChunk } from "@/lib/scans/process-chunk";
import { SupabaseScanStore } from "@/lib/scans/persist";
import { chunkSchema } from "@/lib/scans/schemas";
import { getFingerprintPepper } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";

/** Margen sobre el lote de 3 MB para el envoltorio JSON (el body de Vercel admite 4.5 MB). */
const MAX_BODY_BYTES = ZIP_LIMITS.maxChunkBytes + 512 * 1024;

export const maxDuration = 60;

/** POST /api/scans/[id]/chunks: analiza un lote de archivos en memoria. */
export async function POST(request: Request, context: RouteContext<"/api/scans/[id]/chunks">) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthorized", "Inicia sesión para continuar.");

  const { id } = await context.params;
  const scanId = z.uuid().safeParse(id);
  if (!scanId.success) return jsonError(404, "scan_not_found", "El escaneo no existe.");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = chunkSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Lote inválido.");
  }

  try {
    const store = new SupabaseScanStore(createSupabaseAdminClient());
    const result = await processChunk(store, user.id, scanId.data, parsed.data, {
      pepper: getFingerprintPepper(),
      now: new Date(),
    });
    if (!result.ok) {
      return result.error === "scan_not_found"
        ? jsonError(404, result.error, "El escaneo no existe.")
        : jsonError(409, result.error, "El escaneo ya no acepta lotes.");
    }
    return jsonOk({
      chunk_index: parsed.data.chunk_index,
      duplicate: result.duplicate,
      files_scanned: result.summary?.files_scanned ?? 0,
      occurrences: result.summary?.occurrences ?? 0,
    });
  } catch (error) {
    logInternalError("api/scans/chunks", error);
    return jsonError(500, "internal_error", "No se pudo procesar el lote.");
  }
}
