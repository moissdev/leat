import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScan } from "@/lib/scans/create";
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
