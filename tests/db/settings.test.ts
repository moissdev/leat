import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CURRENT_KEY_VERSION } from "@/lib/alerts/crypto";
import { SupabaseAlertStore } from "@/lib/alerts/store";
import { getWebhookEncryptionKey } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { alnum } from "../fixtures/secrets";

/**
 * Con la SESIÓN de un usuario, el webhook cifrado no es legible ni escribible:
 * los GRANT por columna solo exponen `webhook_configured`, `alerts_enabled`
 * y `updated_at`. Usuario temporal en el Supabase de desarrollo.
 */

const admin = createSupabaseAdminClient();
const FAKE_WEBHOOK = "https://discord.com/api/webhooks/" + "123456789012345678" + "/" + alnum(68, 8);
let userId = "";
let client: SupabaseClient<Database>;

beforeAll(async () => {
  const email = `leat-test-${randomUUID()}@example.com`;
  const password = `${randomUUID()}-A1!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario (${error?.code ?? "?"})`);
  userId = data.user.id;

  await new SupabaseAlertStore(admin, getWebhookEncryptionKey).saveWebhookUrl(userId, FAKE_WEBHOOK, CURRENT_KEY_VERSION);

  const { url, anonKey } = getSupabasePublicEnv();
  client = createClient<Database>(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`No se pudo iniciar sesión (${signIn.error.code ?? "?"})`);
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("user_settings con la sesión del usuario (integración)", () => {
  it("lee solo las columnas permitidas", async () => {
    const { data, error } = await client.from("user_settings").select("webhook_configured, alerts_enabled, updated_at").single();
    expect(error).toBeNull();
    expect(data?.webhook_configured).toBe(true);
    expect(JSON.stringify(data)).not.toContain(FAKE_WEBHOOK);
  });

  it.each(["discord_webhook_ct", "discord_webhook_iv", "discord_webhook_tag", "*"])(
    "no puede leer %s",
    async (columns) => {
      const { data, error } = await client.from("user_settings").select(columns);
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    },
  );

  it("puede activar y desactivar alertas, pero no tocar el webhook", async () => {
    const toggle = await client.from("user_settings").update({ alerts_enabled: false }).eq("user_id", userId).select("alerts_enabled");
    expect(toggle.data).toEqual([{ alerts_enabled: false }]);

    const tamper = await client.from("user_settings").update({ discord_webhook_ct: "x" }).eq("user_id", userId);
    expect(tamper.error?.code).toBe("42501");
  });
});
