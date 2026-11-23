import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

/**
 * Cambio de estado con la SESIÓN de un usuario (RLS, como la acción del
 * checkpoint 17): las transiciones quedan en el log con actor `user`, y nadie
 * puede tocar hallazgos ajenos ni columnas fuera de `status`/`status_note`.
 * Dos usuarios temporales en el Supabase de desarrollo; se borran al final.
 */

const admin = createSupabaseAdminClient();
const users: { id: string; client: SupabaseClient<Database> }[] = [];
let findingId = "";

async function createSignedInUser() {
  const email = `leat-test-${randomUUID()}@example.com`;
  const password = `${randomUUID()}-A1!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario (${error?.code ?? "?"})`);
  const { url, anonKey } = getSupabasePublicEnv();
  const client = createClient<Database>(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`No se pudo iniciar sesión (${signIn.error.code ?? "?"})`);
  const user = { id: data.user.id, client };
  users.push(user);
  return user;
}

beforeAll(async () => {
  const owner = await createSignedInUser();
  await createSignedInUser();
  const project = await admin.from("projects").insert({ user_id: owner.id, name: "leat-status-test" }).select("id").single();
  if (project.error) throw new Error(project.error.code);
  const finding = await admin
    .from("findings")
    .insert({
      user_id: owner.id,
      project_id: project.data.id,
      fingerprint: "f".repeat(64),
      secret_type: "github_token",
      severity: "high",
      method: "regex",
      masked_value: "ghp_...aB3d",
    })
    .select("id")
    .single();
  if (finding.error) throw new Error(finding.error.code);
  findingId = finding.data.id;
});

afterAll(async () => {
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
});

describe("cambio de estado por el usuario (integración)", () => {
  it("cada transición queda en el log con actor user, la nota como motivo y el TTR al resolver", async () => {
    const owner = users[0];
    if (!owner) throw new Error("sin usuario");

    for (const [status, note] of [
      ["ignored", "Riesgo aceptado"],
      ["resolved", "Rotado en GitHub"],
    ] as const) {
      const { data, error } = await owner.client
        .from("findings")
        .update({ status, status_note: note })
        .eq("id", findingId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }

    const logs = await owner.client
      .from("vulnerability_lifecycle_logs")
      .select("from_status, to_status, actor, reason, ttr_seconds")
      .eq("finding_id", findingId)
      .order("id");
    expect(logs.data?.map((l) => [l.from_status, l.to_status, l.actor, l.reason])).toEqual([
      [null, "active", "system", "first_detected"],
      ["active", "ignored", "user", "Riesgo aceptado"],
      ["ignored", "resolved", "user", "Rotado en GitHub"],
    ]);
    expect(typeof logs.data?.at(-1)?.ttr_seconds).toBe("number");
  });

  it("otro usuario no puede ver ni cambiar el hallazgo", async () => {
    const intruder = users[1];
    if (!intruder) throw new Error("sin usuario");
    const read = await intruder.client.from("findings").select("id").eq("id", findingId);
    expect(read.data).toEqual([]);
    const update = await intruder.client.from("findings").update({ status: "active" }).eq("id", findingId).select("id");
    expect(update.data ?? []).toEqual([]);
  });

  it("el dueño no puede cambiar columnas fuera de status y status_note", async () => {
    const owner = users[0];
    if (!owner) throw new Error("sin usuario");
    const { error } = await owner.client.from("findings").update({ severity: "low" }).eq("id", findingId);
    expect(error?.code).toBe("42501");
  });
});
