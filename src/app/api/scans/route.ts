import { after } from "next/server";
import { sendScanAlerts } from "@/lib/alerts/send";
import { jsonError, jsonOk, logInternalError, readJsonBody } from "@/lib/api/http";
import { runGithubScan } from "@/lib/ingest/github";
import { OctokitGithubClient } from "@/lib/ingest/github-client";
import { createScan } from "@/lib/scans/create";
import { SupabaseScanStore } from "@/lib/scans/persist";
import { createScanSchema } from "@/lib/scans/schemas";
import { getFingerprintPepper } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";

const MAX_BODY_BYTES = 16 * 1024;

/**
 * El escaneo de GitHub corre en segundo plano con `after()` dentro de esta
 * función, así que necesita la duración máxima (GITHUB_LIMITS.maxDurationSeconds).
 * Debe ser un literal para que Next lo analice estáticamente.
 */
export const maxDuration = 300;

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

    const input = parsed.data;
    if (input.ingest === "github") {
      // El servidor orquesta GitHub en segundo plano; la UI sigue el progreso por Realtime.
      const userId = user.id;
      const scan = result.scan;
      const scanUrl = `${new URL(request.url).origin}/scans/${scan.id}`;
      after(async () => {
        const outcome = await runGithubScan(
          {
            store,
            github: OctokitGithubClient.fromEnv(),
            pepper: getFingerprintPepper(),
            clock: () => Date.now(),
          },
          userId,
          scan.id,
          input.repo_url,
        );
        if (outcome.status === "completed" && outcome.finalize.ok && !outcome.finalize.alreadyCompleted) {
          const { result: finalized } = outcome.finalize;
          await sendScanAlerts({
            userId,
            scanId: scan.id,
            projectId: finalized.projectId,
            newFindingIds: finalized.newFindingIds,
            reopenedFindingIds: finalized.reopenedFindingIds,
            scanUrl,
          });
        }
      });
    }

    return jsonOk({ scan_id: result.scan.id, status: result.scan.status }, 201);
  } catch (error) {
    logInternalError("api/scans", error);
    return jsonError(500, "internal_error", "No se pudo crear el escaneo.");
  }
}
