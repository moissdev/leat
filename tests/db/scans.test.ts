import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { failOrphanScans } from "@/lib/scans/cleanup";
import { createScan } from "@/lib/scans/create";
import { finalizeScan } from "@/lib/scans/finalize";
import { SupabaseScanStore } from "@/lib/scans/persist";
import { processChunk } from "@/lib/scans/process-chunk";
import { getFingerprintPepper } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { alnum, FAKE } from "../fixtures/secrets";

/**
 * Integración de `SupabaseScanStore` contra el Supabase de DESARROLLO.
 * Crea un usuario temporal (correo @example.com, ya confirmado) con un
 * proyecto, ejecuta el flujo de escaneo y lo borra al final (cascada).
 * Ejecutar solo con `npm run test:db` y con autorización.
 */

const admin = createSupabaseAdminClient();
const store = new SupabaseScanStore(admin);
let userId = "";
let projectId = "";

beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `leat-test-${randomUUID()}@example.com`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba (${error?.code ?? "?"})`);
  userId = data.user.id;

  const project = await admin
    .from("projects")
    .insert({ user_id: userId, name: "leat-integration-test" })
    .select("id")
    .single();
  if (project.error) throw new Error(`No se pudo crear el proyecto (${project.error.code})`);
  projectId = project.data.id;
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("SupabaseScanStore (integración)", () => {
  const options = () => ({ pepper: getFingerprintPepper(), now: new Date() });

  it("crea el escaneo, procesa un lote y es idempotente", async () => {
    const created = await createScan(store, userId, { ingest: "zip", project_id: projectId, source_name: "t.zip" }, new Date());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const scanId = created.scan.id;

    const input = {
      chunk_index: 0,
      files: [
        { path: "src/a.ts", content: `const k = "${FAKE.awsAccessKey}";\nconst g = "${FAKE.githubToken}";` },
        { path: "src/b.ts", content: `const k = "${FAKE.awsAccessKey}";` },
      ],
    };
    const first = await processChunk(store, userId, scanId, input, options());
    expect(first.ok && first.summary?.new_finding_ids).toHaveLength(2);

    const retry = await processChunk(store, userId, scanId, input, options());
    expect(retry).toMatchObject({ ok: true, duplicate: true });

    const scan = await admin.from("scans").select("*").eq("id", scanId).single();
    expect(scan.data).toMatchObject({ status: "running", chunks_received: 1, files_scanned: 2, occurrences_total: 3 });

    const occurrences = await admin.from("finding_occurrences").select("masked_context").eq("scan_id", scanId);
    expect(occurrences.data).toHaveLength(3);
    expect(JSON.stringify(occurrences.data)).not.toContain(FAKE.awsAccessKey);

    // El trigger registró la primera detección de cada hallazgo.
    const logs = await admin.from("vulnerability_lifecycle_logs").select("reason").eq("user_id", userId);
    expect(logs.data?.map((l) => l.reason)).toEqual(["first_detected", "first_detected"]);
  });

  it("reabre un hallazgo resuelto y el trigger registra la transición", async () => {
    const [finding] = (await admin.from("findings").select("id").eq("user_id", userId).limit(1)).data ?? [];
    if (!finding) throw new Error("sin hallazgos");
    await admin.from("findings").update({ status: "resolved", status_note: "no_longer_detected" }).eq("id", finding.id);
    await admin.from("scans").update({ status: "completed" }).eq("user_id", userId);

    const created = await createScan(store, userId, { ingest: "snippet", project_id: projectId }, new Date());
    if (!created.ok) throw new Error(created.error);
    const content = `${FAKE.awsAccessKey}\n${FAKE.githubToken}`;
    const result = await processChunk(store, userId, created.scan.id, { chunk_index: 0, files: [{ path: "s", content }] }, options());
    expect(result.ok && result.summary?.reopened_finding_ids).toEqual([finding.id]);

    const last = await admin
      .from("vulnerability_lifecycle_logs")
      .select("from_status, to_status, actor, reason")
      .eq("finding_id", finding.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(last.data).toEqual({ from_status: "resolved", to_status: "active", actor: "system", reason: "redetected" });
  });

  it("procesa 40 hallazgos nuevos y su re-detección en tiempo razonable", async () => {
    await admin.from("scans").update({ status: "completed" }).eq("user_id", userId);
    const content = Array.from({ length: 40 }, (_, i) => `token_${i} = "${alnum(36, i)}${String(i).padStart(4, "0")}";`).join("\n");
    const run = async (chunkProject: string) => {
      const created = await createScan(store, userId, { ingest: "snippet", project_id: chunkProject }, new Date());
      if (!created.ok) throw new Error(created.error);
      const startedAt = performance.now();
      const result = await processChunk(store, userId, created.scan.id, { chunk_index: 0, files: [{ path: "many.ts", content }] }, options());
      await admin.from("scans").update({ status: "completed" }).eq("id", created.scan.id);
      return { result, ms: performance.now() - startedAt };
    };

    const first = await run(projectId);
    expect(first.result.ok && first.result.summary?.new_finding_ids).toHaveLength(40);
    const second = await run(projectId);
    expect(second.result.ok && second.result.summary?.occurrences).toBe(40);
    console.info(`40 hallazgos: nuevos ${Math.round(first.ms)} ms, re-detección ${Math.round(second.ms)} ms`);
    expect(second.ms).toBeLessThan(15_000);
  });

  it("no ve escaneos de otro usuario", async () => {
    const [scan] = (await admin.from("scans").select("id").eq("user_id", userId).limit(1)).data ?? [];
    if (!scan) throw new Error("sin escaneos");
    expect(await store.getScan(randomUUID(), scan.id)).toBeNull();
  });
});

describe("finalize, auto-resolución y limpieza (integración)", () => {
  const options = () => ({ pepper: getFingerprintPepper(), now: new Date() });
  const FULL = { files_total: 1, files_skipped: 0, files_truncated: 0 };

  it("un ZIP completo auto-resuelve lo que falta y el trigger guarda el TTR", async () => {
    await admin.from("scans").update({ status: "completed" }).eq("user_id", userId);
    const project = await admin.from("projects").insert({ user_id: userId, name: "leat-finalize-test" }).select("id").single();
    if (project.error) throw new Error(project.error.code);

    const scanZip = async (content: string) => {
      const created = await createScan(store, userId, { ingest: "zip", project_id: project.data.id, source_name: "z.zip" }, new Date());
      if (!created.ok) throw new Error(created.error);
      await processChunk(store, userId, created.scan.id, { chunk_index: 0, files: [{ path: "a.ts", content }] }, options());
      return finalizeScan(store, userId, created.scan.id, FULL, new Date());
    };

    const first = await scanZip(`a="${FAKE.awsAccessKey}"\nb="${FAKE.slackToken}"`);
    expect(first.ok && first.result?.findingsNew).toBe(2);
    const second = await scanZip(`a="${FAKE.awsAccessKey}"`);
    expect(second.ok && second.result?.autoResolved).toBe(1);

    const resolved = await admin
      .from("findings")
      .select("id, status, resolved_at")
      .eq("project_id", project.data.id)
      .eq("status", "resolved")
      .single();
    expect(resolved.data?.resolved_at).not.toBeNull();

    const log = await admin
      .from("vulnerability_lifecycle_logs")
      .select("from_status, to_status, actor, reason, ttr_seconds")
      .eq("finding_id", resolved.data?.id ?? "")
      .eq("to_status", "resolved")
      .single();
    expect(log.data).toMatchObject({ from_status: "active", actor: "system", reason: "no_longer_detected" });
    expect(typeof log.data?.ttr_seconds).toBe("number");

    const scan = await admin.from("scan_report_v").select("status, is_full_scan, findings_new, duration_ms").eq("project_id", project.data.id).order("created_at").limit(1).single();
    expect(scan.data).toMatchObject({ status: "completed", is_full_scan: true, findings_new: 2 });
  });

  it("marca failed un escaneo huérfano (> 15 min sin actividad)", async () => {
    await admin.from("scans").update({ status: "completed" }).eq("user_id", userId);
    const created = await createScan(store, userId, { ingest: "snippet", project_id: projectId }, new Date());
    if (!created.ok) throw new Error(created.error);
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    await admin.from("scans").update({ created_at: old }).eq("id", created.scan.id);
    await admin.from("scan_logs").update({ created_at: old }).eq("scan_id", created.scan.id);

    expect(await failOrphanScans(store, userId, new Date())).toBe(1);
    const scan = await admin.from("scans").select("status, error_message").eq("id", created.scan.id).single();
    expect(scan.data).toEqual({ status: "failed", error_message: "timeout" });
  });
});
