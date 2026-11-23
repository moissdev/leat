import { after } from "next/server";
import { z } from "zod";
import { sendScanAlerts } from "@/lib/alerts/send";
import { jsonError, jsonOk, logInternalError, readJsonBody } from "@/lib/api/http";
import { finalizeScan } from "@/lib/scans/finalize";
import { SupabaseScanStore } from "@/lib/scans/persist";
import { finalizeSchema } from "@/lib/scans/schemas";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";

const MAX_BODY_BYTES = 4 * 1024;

export const maxDuration = 60;

/** POST /api/scans/[id]/finalize: cierra el escaneo y aplica la auto-resolución. */
export async function POST(request: Request, context: RouteContext<"/api/scans/[id]/finalize">) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthorized", "Inicia sesión para continuar.");

  const { id } = await context.params;
  const scanId = z.uuid().safeParse(id);
  if (!scanId.success) return jsonError(404, "scan_not_found", "El escaneo no existe.");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  const parsed = finalizeSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError(400, "invalid_request", parsed.error.issues[0]?.message ?? "Petición inválida.");
  }

  try {
    const store = new SupabaseScanStore(createSupabaseAdminClient());
    const outcome = await finalizeScan(store, user.id, scanId.data, parsed.data, new Date());
    if (!outcome.ok) {
      return outcome.error === "scan_not_found"
        ? jsonError(404, outcome.error, "El escaneo no existe.")
        : jsonError(409, outcome.error, "El escaneo no se puede finalizar.");
    }
    if (outcome.alreadyCompleted) return jsonOk({ status: "completed", already_completed: true });

    const { result } = outcome;

    // Alertas best-effort DESPUÉS de responder: no bloquean el cierre del escaneo.
    const userId = user.id;
    const scanUrl = `${new URL(request.url).origin}/scans/${scanId.data}`;
    after(async () => {
      await sendScanAlerts({
        userId,
        scanId: scanId.data,
        projectId: result.projectId,
        newFindingIds: result.newFindingIds,
        reopenedFindingIds: result.reopenedFindingIds,
        scanUrl,
      });
    });

    return jsonOk({
      status: "completed",
      already_completed: false,
      is_full_scan: result.isFullScan,
      findings_new: result.findingsNew,
      findings_reopened: result.findingsReopened,
      auto_resolved: result.autoResolved,
    });
  } catch (error) {
    logInternalError("api/scans/finalize", error);
    return jsonError(500, "internal_error", "No se pudo finalizar el escaneo.");
  }
}
