import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CURRENT_KEY_VERSION } from "@/lib/alerts/crypto";
import { SupabaseAlertStore } from "@/lib/alerts/store";
import { RATE_LIMITS } from "@/lib/config";
import { createScan } from "@/lib/scans/create";
import { finalizeScan } from "@/lib/scans/finalize";
import { SupabaseScanStore } from "@/lib/scans/persist";
import { processChunk } from "@/lib/scans/process-chunk";
import { getFingerprintPepper, getWebhookEncryptionKey } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { alnum, FAKE } from "../fixtures/secrets";

/**
 * Auditoría de seguridad (checkpoint 21) contra el Supabase de DESARROLLO:
 * - RLS con dos cuentas: B no ve ni modifica nada de A en ninguna tabla o vista.
 * - Los logs son append-only para el usuario.
 * - Rate limit contado sobre `scans`.
 * - Ningún secreto en texto plano en ninguna tabla.
 * Usuarios temporales; se borran al final (cascada).
 */

const admin = createSupabaseAdminClient();
const store = new SupabaseScanStore(admin);
const { url, anonKey } = getSupabasePublicEnv();
const FAKE_WEBHOOK = "https://discord.com/api/webhooks/" + "123456789012345678" + "/" + alnum(68, 9);
const SECRETS = [FAKE.awsAccessKey, FAKE.githubToken, FAKE.stripeLiveKey, FAKE.dbPassword, FAKE.supabaseServiceRole, FAKE_WEBHOOK];

interface TestUser {
  id: string;
  client: SupabaseClient<Database>;
}
const created: string[] = [];
let a: TestUser;
let b: TestUser;
let projectA = "";
let scanA = "";
let findingA = "";

async function signedInUser(): Promise<TestUser> {
  const email = `leat-test-${randomUUID()}@example.com`;
  const password = `${randomUUID()}-A1!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario (${error?.code ?? "?"})`);
  created.push(data.user.id);
  const client = createClient<Database>(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`No se pudo iniciar sesión (${signIn.error.code ?? "?"})`);
  return { id: data.user.id, client };
}

beforeAll(async () => {
  a = await signedInUser();
  b = await signedInUser();

  // Actividad real de A en todas las tablas.
  const project = await a.client.from("projects").insert({ name: "auditoria-a" }).select("id").single();
  if (project.error) throw new Error(project.error.code);
  projectA = project.data.id;

  const scan = await createScan(store, a.id, { ingest: "zip", project_id: projectA, source_name: "a.zip" }, new Date());
  if (!scan.ok) throw new Error(scan.error);
  scanA = scan.scan.id;
  const content = [
    `const aws = "${FAKE.awsAccessKey}", gh = "${FAKE.githubToken}";`,
    `stripe("${FAKE.stripeLiveKey}")`,
    `DATABASE_URL=postgres://app:${FAKE.dbPassword}@db.example.com/app`,
    `SUPABASE_KEY="${FAKE.supabaseServiceRole}"`,
  ].join("\n");
  await processChunk(store, a.id, scanA, { chunk_index: 0, files: [{ path: "src/leak.ts", content }] }, {
    pepper: getFingerprintPepper(),
    now: new Date(),
  });
  await finalizeScan(store, a.id, scanA, { files_total: 1, files_skipped: 0, files_truncated: 0 }, new Date());

  const alerts = new SupabaseAlertStore(admin, getWebhookEncryptionKey);
  await alerts.saveWebhookUrl(a.id, FAKE_WEBHOOK, CURRENT_KEY_VERSION);
  await alerts.logAttempt({ userId: a.id, scanId: scanA, severity: "critical", attempt: 1, success: true, httpStatus: 204, error: null });

  const finding = await a.client.from("findings").select("id").limit(1).single();
  if (finding.error) throw new Error(finding.error.code);
  findingA = finding.data.id;
  await a.client.from("findings").update({ status: "resolved", status_note: "rotada" }).eq("id", findingA);
});

afterAll(async () => {
  for (const id of created) await admin.auth.admin.deleteUser(id);
});

const TABLES = [
  "projects",
  "scans",
  "findings",
  "finding_occurrences",
  "scan_logs",
  "vulnerability_lifecycle_logs",
  "alert_logs",
] as const;
const VIEWS = ["scan_report_v", "project_score_v", "ttr_summary_v"] as const;
type Relation = (typeof TABLES)[number] | (typeof VIEWS)[number];

/** `from()` no acepta la unión de tablas y vistas; todas tienen `user_id`. */
function from(client: SupabaseClient<Database>, relation: Relation) {
  return client.from(relation as "projects");
}

describe("RLS con dos cuentas", () => {
  it.each([...TABLES, ...VIEWS])("A ve sus filas de %s", async (table) => {
    const { count, error } = await from(a.client, table).select("*", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBeGreaterThan(0);
  });

  it.each([...TABLES, ...VIEWS])("B no ve ninguna fila de A en %s", async (table) => {
    const { data, error } = await from(b.client, table).select("user_id");
    expect(error).toBeNull();
    expect((data ?? []).filter((r) => r.user_id === a.id)).toEqual([]);
  });

  it("B no ve la configuración de alertas de A", async () => {
    const { data } = await b.client.from("user_settings").select("user_id, webhook_configured");
    expect((data ?? []).filter((r) => r.user_id === a.id)).toEqual([]);
  });

  it("B no puede modificar ni borrar lo de A", async () => {
    const rename = await b.client.from("projects").update({ name: "hackeado" }).eq("id", projectA).select("id");
    expect(rename.data ?? []).toEqual([]);
    const remove = await b.client.from("projects").delete().eq("id", projectA).select("id");
    expect(remove.data ?? []).toEqual([]);
    const status = await b.client.from("findings").update({ status: "ignored" }).eq("id", findingA).select("id");
    expect(status.data ?? []).toEqual([]);

    const still = await admin.from("projects").select("name").eq("id", projectA).single();
    expect(still.data?.name).toBe("auditoria-a");
  });

  it("B no puede crear un proyecto a nombre de A", async () => {
    const { error } = await b.client.from("projects").insert({ name: "suplantado", user_id: a.id } as never);
    expect(error).not.toBeNull();
  });

  it.each(["scans", "findings", "finding_occurrences", "scan_logs", "alert_logs"] as const)(
    "ningún usuario puede insertar directamente en %s (solo el motor con service_role)",
    async (table) => {
      const { error } = await a.client.from(table).insert({} as never);
      expect(error?.code).toBe("42501");
    },
  );

  it("anon no lee nada", async () => {
    const anon = createClient<Database>(url, anonKey, { auth: { persistSession: false } });
    for (const table of [...TABLES, ...VIEWS]) {
      const { data, error } = await from(anon, table).select("*").limit(1);
      expect(error !== null || (data ?? []).length === 0, table).toBe(true);
    }
  });
});

describe("logs append-only para el usuario", () => {
  it.each(["scan_logs", "vulnerability_lifecycle_logs", "alert_logs"] as const)("A no puede modificar ni borrar %s", async (table) => {
    const update = await a.client.from(table).update({ created_at: new Date(0).toISOString() } as never).eq("user_id", a.id);
    expect(update.error?.code).toBe("42501");
    const remove = await a.client.from(table).delete().eq("user_id", a.id);
    expect(remove.error?.code).toBe("42501");
  });
});

describe("rate limit sobre scans (integración)", () => {
  it(`bloquea el escaneo ${RATE_LIMITS.maxScansPerHour + 1} de la hora y respeta el máximo en curso`, async () => {
    const project = await admin.from("projects").insert({ user_id: b.id, name: "rate-limit" }).select("id").single();
    if (project.error) throw new Error(project.error.code);
    const input = { ingest: "snippet" as const, project_id: project.data.id };

    for (let i = 0; i < RATE_LIMITS.maxConcurrentScans; i += 1) {
      expect((await createScan(store, b.id, input, new Date())).ok).toBe(true);
    }
    expect(await createScan(store, b.id, input, new Date())).toEqual({ ok: false, error: "concurrent_limit" });

    await admin.from("scans").update({ status: "completed" }).eq("user_id", b.id);
    for (let i = RATE_LIMITS.maxConcurrentScans; i < RATE_LIMITS.maxScansPerHour; i += 1) {
      expect((await createScan(store, b.id, input, new Date())).ok).toBe(true);
      await admin.from("scans").update({ status: "completed" }).eq("user_id", b.id);
    }
    expect(await createScan(store, b.id, input, new Date())).toEqual({ ok: false, error: "hourly_limit" });
  });
});

describe("ningún secreto en texto plano en la base", () => {
  it("ninguna tabla del usuario contiene los secretos escaneados ni el webhook", async () => {
    const dump: unknown[] = [];
    for (const table of [...TABLES, "user_settings"] as const) {
      const { data } = await admin.from(table).select("*").eq("user_id", a.id);
      dump.push(...(data ?? []));
    }
    expect(dump.length).toBeGreaterThan(10);
    const json = JSON.stringify(dump);
    for (const secret of SECRETS) {
      expect(json.includes(secret), `se encontró un secreto de ${secret.length} caracteres`).toBe(false);
    }
  });
});
