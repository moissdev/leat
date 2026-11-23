import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CURRENT_KEY_VERSION } from "@/lib/alerts/crypto";
import { SupabaseAlertStore } from "@/lib/alerts/store";
import { getWebhookEncryptionKey } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { alnum } from "../fixtures/secrets";

/**
 * Integración del webhook cifrado contra el Supabase de DESARROLLO.
 * Usa una URL FALSA (no se envía nada a Discord) y un usuario temporal.
 */

const admin = createSupabaseAdminClient();
const store = new SupabaseAlertStore(admin, getWebhookEncryptionKey);
const FAKE_WEBHOOK = "https://discord.com/api/webhooks/" + "123456789012345678" + "/" + alnum(68, 5);
let userId = "";

beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `leat-test-${randomUUID()}@example.com`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba (${error?.code ?? "?"})`);
  userId = data.user.id;
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("SupabaseAlertStore (integración)", () => {
  it("la clave LEAT_WEBHOOK_ENCRYPTION_KEY tiene un formato válido", () => {
    expect(getWebhookEncryptionKey(CURRENT_KEY_VERSION)).toHaveLength(32);
  });

  it("guarda el webhook cifrado y lo recupera en el servidor", async () => {
    await store.saveWebhookUrl(userId, FAKE_WEBHOOK, CURRENT_KEY_VERSION);

    const row = await admin.from("user_settings").select("*").eq("user_id", userId).single();
    expect(row.data?.webhook_configured).toBe(true);
    expect(JSON.stringify(row.data)).not.toContain(FAKE_WEBHOOK);
    expect(JSON.stringify(row.data)).not.toContain(FAKE_WEBHOOK.split("/").pop());

    expect(await store.getActiveWebhookUrl(userId)).toBe(FAKE_WEBHOOK);
  });

  it("con las alertas desactivadas no hay webhook activo, pero la prueba sí puede leerlo", async () => {
    await admin.from("user_settings").update({ alerts_enabled: false }).eq("user_id", userId);
    expect(await store.getActiveWebhookUrl(userId)).toBeNull();
    expect(await store.getWebhookUrl(userId, { requireEnabled: false })).toBe(FAKE_WEBHOOK);
    await admin.from("user_settings").update({ alerts_enabled: true }).eq("user_id", userId);
  });

  it("registra intentos en alert_logs", async () => {
    await store.logAttempt({ userId, scanId: null, severity: "high", attempt: 1, success: false, httpStatus: 500, error: "http_500" });
    const logs = await admin.from("alert_logs").select("attempt, success, http_status, error").eq("user_id", userId);
    expect(logs.data).toEqual([{ attempt: 1, success: false, http_status: 500, error: "http_500" }]);
  });

  it("elimina el webhook", async () => {
    await store.deleteWebhookUrl(userId);
    const row = await admin.from("user_settings").select("webhook_configured").eq("user_id", userId).single();
    expect(row.data?.webhook_configured).toBe(false);
    expect(await store.getActiveWebhookUrl(userId)).toBeNull();
  });
});
