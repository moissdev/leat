import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { SCAN_LIMITS } from "@/lib/config";
import { createScan } from "@/lib/scans/create";
import { clipContext, MAX_STORED_CONTEXT, processChunk, runWithConcurrency } from "@/lib/scans/process-chunk";
import { chunkSchema, type ChunkInput } from "@/lib/scans/schemas";
import { alnum, FAKE } from "../fixtures/secrets";
import { MemoryScanStore } from "./memory-store";

const USER = randomUUID();
const OTHER_USER = randomUUID();
const PEPPER = alnum(64, 30);
const NOW = new Date("2026-01-01T12:00:00Z");
const options = { pepper: PEPPER, now: NOW };

const chunk = (chunkIndex: number, files: { path: string; content: string }[]): ChunkInput => ({
  chunk_index: chunkIndex,
  files,
});

describe("processChunk", () => {
  let store: MemoryScanStore;
  let projectId: string;

  async function newScan(ingest: "zip" | "snippet" = "zip"): Promise<string> {
    const r =
      ingest === "zip"
        ? await createScan(store, USER, { ingest, project_id: projectId, source_name: "x.zip" }, NOW)
        : await createScan(store, USER, { ingest, project_id: projectId }, NOW);
    if (!r.ok) throw new Error(r.error);
    return r.scan.id;
  }

  beforeEach(() => {
    store = new MemoryScanStore();
    projectId = store.addProject(USER);
  });

  it("crea hallazgos activos con ocurrencias y pasa el escaneo a running", async () => {
    const scanId = await newScan();
    const result = await processChunk(
      store,
      USER,
      scanId,
      chunk(0, [
        { path: "src/aws.ts", content: `const k = "${FAKE.awsAccessKey}";` },
        { path: "src/clean.ts", content: "export const a = 1;" },
      ]),
      options,
    );
    expect(result.ok && !result.duplicate).toBe(true);
    expect(store.findings).toHaveLength(1);
    expect(store.findings[0]).toMatchObject({ status: "active", severity: "critical", secretType: "aws_access_key" });
    expect(store.occurrences).toHaveLength(1);
    expect(store.occurrences[0]).toMatchObject({ filePath: "src/aws.ts", lineNumber: 1 });
    expect(store.scans[0]).toMatchObject({ status: "running", filesScanned: 2, chunksReceived: 1, occurrencesTotal: 1 });
    expect(store.transitions).toEqual([
      expect.objectContaining({ from: null, to: "active", reason: "first_detected" }),
    ]);
  });

  it("un secreto repetido es UN hallazgo con varias ocurrencias", async () => {
    const scanId = await newScan();
    const line = `token = "${FAKE.githubToken}"`;
    await processChunk(
      store,
      USER,
      scanId,
      chunk(0, [
        { path: "a.ts", content: `${line}\n${line}` },
        { path: "b.ts", content: line },
      ]),
      options,
    );
    expect(store.findings).toHaveLength(1);
    expect(store.occurrences.map((o) => `${o.filePath}:${o.lineNumber}`).sort()).toEqual(["a.ts:1", "a.ts:2", "b.ts:1"]);
  });

  it("es idempotente por chunk_index: el reintento no duplica contadores ni filas", async () => {
    const scanId = await newScan();
    const input = chunk(0, [{ path: "a.ts", content: `k = "${FAKE.stripeLiveKey}"` }]);
    await processChunk(store, USER, scanId, input, options);
    const retry = await processChunk(store, USER, scanId, input, options);
    expect(retry).toEqual({ ok: true, duplicate: true, summary: null });
    expect(store.findings).toHaveLength(1);
    expect(store.occurrences).toHaveLength(1);
    expect(store.scans[0]).toMatchObject({ chunksReceived: 1, filesScanned: 1 });
  });

  it("suma los contadores de varios lotes", async () => {
    const scanId = await newScan();
    await processChunk(store, USER, scanId, chunk(0, [{ path: "a.ts", content: "x" }]), options);
    await processChunk(store, USER, scanId, chunk(1, [{ path: "b.ts", content: "y" }, { path: "c.ts", content: "z" }]), options);
    expect(store.scans[0]).toMatchObject({ chunksReceived: 2, filesScanned: 3, bytesScanned: 3 });
  });

  describe("ciclo de vida en re-detección", () => {
    async function detectOnce(): Promise<void> {
      const scanId = await newScan();
      await processChunk(store, USER, scanId, chunk(0, [{ path: "a.ts", content: `k="${FAKE.awsAccessKey}"` }]), options);
      const scan = store.scans.find((s) => s.id === scanId);
      if (scan) scan.status = "completed";
    }

    it("un hallazgo resolved se reabre a active (actor system)", async () => {
      await detectOnce();
      const finding = store.findings[0];
      if (!finding) throw new Error("sin hallazgo");
      store.setStatus(finding, "resolved", "no_longer_detected");

      const scanId = await newScan();
      const result = await processChunk(store, USER, scanId, chunk(0, [{ path: "a.ts", content: `k="${FAKE.awsAccessKey}"` }]), options);
      expect(finding.status).toBe("active");
      expect(result.ok && result.summary?.reopened_finding_ids).toEqual([finding.id]);
      expect(store.transitions.at(-1)).toMatchObject({ from: "resolved", to: "active", reason: "redetected" });
    });

    it.each(["ignored", "false_positive"] as const)("un hallazgo %s NO se reabre", async (status) => {
      await detectOnce();
      const finding = store.findings[0];
      if (!finding) throw new Error("sin hallazgo");
      store.setStatus(finding, status, "decisión del usuario");

      const scanId = await newScan();
      const result = await processChunk(store, USER, scanId, chunk(0, [{ path: "a.ts", content: `k="${FAKE.awsAccessKey}"` }]), options);
      expect(finding.status).toBe(status);
      expect(finding.lastScanId).toBe(scanId); // la re-detección sí se registra
      expect(result.ok && result.summary?.reopened_finding_ids).toEqual([]);
      expect(store.occurrences).toHaveLength(2);
    });

    it("sube la severidad si el mismo secreto se detecta con un patrón más grave", async () => {
      const secret = alnum(40, 9);
      const scanA = await newScan();
      await processChunk(store, USER, scanA, chunk(0, [{ path: "a.ts", content: `value = "${secret}"` }]), options);
      expect(store.findings[0]?.severity).toBe("low");
      const a = store.scans.find((s) => s.id === scanA);
      if (a) a.status = "completed";

      const scanB = await newScan();
      await processChunk(store, USER, scanB, chunk(0, [{ path: "a.ts", content: `apiToken = "${secret}"` }]), options);
      expect(store.findings).toHaveLength(1);
      expect(store.findings[0]?.severity).toBe("medium");
    });
  });

  describe("acceso", () => {
    it("rechaza el escaneo de otro usuario sin tocar nada", async () => {
      const scanId = await newScan();
      const result = await processChunk(store, OTHER_USER, scanId, chunk(0, [{ path: "a.ts", content: `k="${FAKE.awsAccessKey}"` }]), options);
      expect(result).toEqual({ ok: false, error: "scan_not_found" });
      expect(store.findings).toHaveLength(0);
    });

    it("rechaza lotes en escaneos terminados", async () => {
      const scanId = await newScan();
      const scan = store.scans[0];
      if (scan) scan.status = "completed";
      expect(await processChunk(store, USER, scanId, chunk(0, [{ path: "a", content: "x" }]), options)).toEqual({
        ok: false,
        error: "scan_not_accepting_chunks",
      });
    });

    it("los hallazgos se deduplican por proyecto, no globalmente", async () => {
      const otherProject = store.addProject(USER);
      const scanA = await newScan();
      await processChunk(store, USER, scanA, chunk(0, [{ path: "a", content: `k="${FAKE.awsAccessKey}"` }]), options);
      const b = await createScan(store, USER, { ingest: "snippet", project_id: otherProject }, NOW);
      if (!b.ok) throw new Error(b.error);
      await processChunk(store, USER, b.scan.id, chunk(0, [{ path: "a", content: `k="${FAKE.awsAccessKey}"` }]), options);
      expect(store.findings).toHaveLength(2);
    });
  });

  describe("límites en el servidor", () => {
    it("cuenta como truncados los archivos que exceden el máximo por escaneo", async () => {
      const scanId = await newScan();
      const scan = store.scans[0];
      if (scan) scan.filesScanned = SCAN_LIMITS.maxFilesPerScan - 1;
      const result = await processChunk(store, USER, scanId, chunk(0, [{ path: "a", content: "1" }, { path: "b", content: "2" }]), options);
      expect(result.ok && result.summary).toMatchObject({ files_scanned: 1, files_truncated: 1 });
    });

    it("omite (sin truncar) rutas ignoradas y binarios", async () => {
      const scanId = await newScan();
      const result = await processChunk(
        store,
        USER,
        scanId,
        chunk(0, [
          { path: "node_modules/x.js", content: `k="${FAKE.awsAccessKey}"` },
          { path: "bin.dat", content: "a\u0000b" },
        ]),
        options,
      );
      expect(result.ok && result.summary).toMatchObject({ files_scanned: 0, files_skipped: 2, files_truncated: 0 });
      expect(store.findings).toHaveLength(0);
    });
  });

  it("nada de lo persistido contiene texto plano", async () => {
    const scanId = await newScan();
    const secrets = [FAKE.awsAccessKey, FAKE.githubToken, FAKE.stripeLiveKey, FAKE.dbPassword, FAKE.supabaseServiceRole];
    const content = [
      `const a = "${FAKE.awsAccessKey}", b = "${FAKE.githubToken}";`,
      `stripe("${FAKE.stripeLiveKey}")`,
      `db = "postgres://u:${FAKE.dbPassword}@h/db"`,
      `${"x".repeat(500)} key="${FAKE.supabaseServiceRole}" ${"y".repeat(500)}`,
    ].join("\n");
    await processChunk(store, USER, scanId, chunk(0, [{ path: "leak.ts", content }]), options);
    const persisted = JSON.stringify({
      scans: store.scans,
      findings: store.findings,
      occurrences: store.occurrences,
      logs: store.logs,
      transitions: store.transitions,
    });
    expect(store.findings).toHaveLength(5);
    for (const secret of secrets) expect(persisted.includes(secret)).toBe(false);
    for (const o of store.occurrences) expect(o.maskedContext.length).toBeLessThanOrEqual(MAX_STORED_CONTEXT);
  });
});

describe("clipContext", () => {
  it("no toca contextos cortos", () => {
    expect(clipContext("const a = 'sk_l...abcd';", "sk_l...abcd")).toBe("const a = 'sk_l...abcd';");
  });

  it("recorta a 300 caracteres centrado en el valor enmascarado", () => {
    const masked = "AKIA...MPLE";
    const context = `${"a".repeat(1000)}${masked}${"b".repeat(1000)}`;
    const clipped = clipContext(context, masked);
    expect(clipped.length).toBeLessThanOrEqual(MAX_STORED_CONTEXT);
    expect(clipped).toContain(masked);
    expect(clipped.startsWith("…") && clipped.endsWith("…")).toBe(true);
  });

  it("si el valor está al inicio no antepone …", () => {
    const clipped = clipContext(`ghp_...abcd ${"z".repeat(800)}`, "ghp_...abcd");
    expect(clipped.startsWith("ghp_...abcd")).toBe(true);
    expect(clipped.length).toBeLessThanOrEqual(MAX_STORED_CONTEXT);
  });
});

describe("chunkSchema", () => {
  it("acepta un lote válido e ignora campos extra", () => {
    const parsed = chunkSchema.parse({ chunk_index: 0, files: [{ path: "a.ts", content: "x" }], user_id: OTHER_USER });
    expect("user_id" in parsed).toBe(false);
  });

  it.each([
    [{ chunk_index: -1, files: [{ path: "a", content: "" }] }],
    [{ chunk_index: 1.5, files: [{ path: "a", content: "" }] }],
    [{ chunk_index: 0, files: [] }],
    [{ chunk_index: 0, files: [{ path: "", content: "" }] }],
    [{ chunk_index: 0, files: [{ path: "a\nb", content: "" }] }],
    [{ chunk_index: 0, files: [{ path: "x".repeat(501), content: "" }] }],
    [{ chunk_index: 0, files: [{ path: "a", content: "x".repeat(SCAN_LIMITS.maxFileBytes + 1) }] }],
  ])("rechaza %#", (input) => {
    expect(chunkSchema.safeParse(input).success).toBe(false);
  });
});

describe("runWithConcurrency", () => {
  it("procesa todos los elementos sin exceder el límite de tareas simultáneas", async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await runWithConcurrency(
      Array.from({ length: 30 }, (_, i) => i),
      4,
      async (i) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        seen.push(i);
        running -= 1;
      },
    );
    expect(peak).toBe(4);
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it("no hace nada con una lista vacía", async () => {
    await expect(runWithConcurrency([], 4, async () => {})).resolves.toBeUndefined();
  });
});
