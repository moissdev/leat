import { z } from "zod";
import { CURRENT_KEY_VERSION } from "@/lib/alerts/crypto";
import { buildTestPayload, discordWebhookUrlSchema } from "@/lib/alerts/discord";
import { postWebhook } from "@/lib/alerts/dispatch";
import { SupabaseAlertStore } from "@/lib/alerts/store";
import { jsonError, jsonOk, logInternalError, readJsonBody } from "@/lib/api/http";
import { getWebhookEncryptionKey } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";

/**
 * Webhook de Discord del usuario:
 * - PUT    guarda (cifrado) la URL del webhook.
 * - DELETE la elimina.
 * - POST   envía un mensaje de prueba.
 * La URL nunca vuelve al cliente: las respuestas solo dicen si está configurado.
 */

const MAX_BODY_BYTES = 2 * 1024;
const putSchema = z.object({ url: discordWebhookUrlSchema });

function alertStore(): SupabaseAlertStore {
  return new SupabaseAlertStore(createSupabaseAdminClient(), getWebhookEncryptionKey);
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthorized", "Inicia sesión para continuar.");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  const parsed = putSchema.safeParse(body.value);
  if (!parsed.success) {
    return jsonError(400, "invalid_webhook", parsed.error.issues[0]?.message ?? "Webhook inválido.");
  }

  try {
    await alertStore().saveWebhookUrl(user.id, parsed.data.url, CURRENT_KEY_VERSION);
    return jsonOk({ webhook_configured: true });
  } catch (error) {
    logInternalError("api/settings/webhook PUT", error);
    return jsonError(500, "internal_error", "No se pudo guardar el webhook.");
  }
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthorized", "Inicia sesión para continuar.");

  try {
    await alertStore().deleteWebhookUrl(user.id);
    return jsonOk({ webhook_configured: false });
  } catch (error) {
    logInternalError("api/settings/webhook DELETE", error);
    return jsonError(500, "internal_error", "No se pudo eliminar el webhook.");
  }
}

export async function POST() {
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthorized", "Inicia sesión para continuar.");

  try {
    // La prueba funciona aunque las alertas estén desactivadas.
    const url = await alertStore().getWebhookUrl(user.id, { requireEnabled: false });
    if (!url) return jsonError(409, "webhook_not_configured", "Primero guarda un webhook.");

    const result = await postWebhook(fetch, url, buildTestPayload(new Date()));
    return result.success
      ? jsonOk({ sent: true })
      : jsonError(502, "webhook_failed", `Discord rechazó el envío (${result.error ?? "error"}).`);
  } catch (error) {
    logInternalError("api/settings/webhook POST", error);
    return jsonError(500, "internal_error", "No se pudo enviar la prueba.");
  }
}
