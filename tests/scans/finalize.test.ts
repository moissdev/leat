import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { SCAN_LIFECYCLE } from "@/lib/config";
import { AUTO_RESOLVE_REASON, shouldAutoResolve } from "@/lib/scans/auto-resolve";
import { failOrphanScans, ORPHAN_ERROR_MESSAGE } from "@/lib/scans/cleanup";
import { createScan } from "@/lib/scans/create";
import { finalizeScan } from "@/lib/scans/finalize";
import type { IngestType } from "@/lib/scans/persist";
import { processChunk } from "@/lib/scans/process-chunk";
import { finalizeSchema } from "@/lib/scans/schemas";
import { alnum, FAKE } from "../fixtures/secrets";
import { MemoryScanStore } from "./memory-store";

const USER = randomUUID();
const OTHER_USER = randomUUID();
const PEPPER = alnum(64, 40);
const NOW = new Date("2026-01-01T12:00:00Z");
const FULL = { files_total: 1, files_skipped: 0, files_truncated: 0 };

describe("finalizeScan y ciclo de vida", () => {
  let store: MemoryScanStore;
  let projectId: string;

  /** Crea, procesa un lote con `content` y finaliza un escaneo. */
  async function runScan(
    ingest: Exclude<IngestType, "github">,
    content: string,
    counts = FULL,
  ): Promise<{ scanId: string; outcome: Awaited<ReturnType<typeof finalizeScan>> }> {
    const created =
      ingest === "snippet"
        ? await createScan(store, USER, { ingest, project_id: projectId }, NOW)
        : await createScan(store, USER, { ingest, project_id: projectId, source_name: "src" }, NOW);
    if (!created.ok) throw new Error(created.error);
    const scanId = created.scan.id;
    await processChunk(store, USER, scanId, { chunk_index: 0, files: [{ path: "a.ts", content }] }, { pepper: PEPPER, now: NOW });
    const outcome = await finalizeScan(store, USER, scanId, counts, NOW);
    return { scanId, outcome };
  }

  const finding = (secret: string) => store.findings.find((f) => f.maskedValue.startsWith(secret.slice(0, 4)));

  beforeEach(() => {
    store = new MemoryScanStore();
    projectId = store.addProject(USER);
  });

  it("nuevo → active; finalize deja el escaneo completed con sus contadores", async () => {
    const { scanId, outcome } = await runScan("zip", `a="${FAKE.awsAccessKey}"\nb="${FAKE.githubToken}"`);
    expect(outcome).toMatchObject({
      ok: true,
      alreadyCompleted: false,
      result: { isFullScan: true, findingsNew: 2, findingsReopened: 0, autoResolved: 0 },
    });
    expect(store.findings.every((f) => f.status === "active")).toBe(true);
    expect(store.scans.find((s) => s.id === scanId)).toMatchObject({
      status: "completed",
      isFullScan: true,
      findingsNew: 2,
      filesTotal: 1,
      filesScanned: 1,
    });
    expect(store.logs.map((l) => l.event)).toEqual(["scan_created", "chunk_processed", "scan_completed"]);
  });

  it("auto-resuelve con un ZIP completo los activos que ya no aparecen (actor system)", async () => {
    await runScan("zip", `a="${FAKE.awsAccessKey}"\nb="${FAKE.githubToken}"`);
    const { outcome } = await runScan("zip", `a="${FAKE.awsAccessKey}"`);
    expect(outcome.ok && outcome.result?.autoResolved).toBe(1);
    expect(finding(FAKE.githubToken)?.status).toBe("resolved");
    expect(finding(FAKE.awsAccessKey)?.status).toBe("active");
    expect(store.transitions.at(-1)).toMatchObject({ from: "active", to: "resolved", reason: AUTO_RESOLVE_REASON });
  });

  it("re-detección de un resuelto lo reabre y se cuenta como reabierto", async () => {
    await runScan("zip", `a="${FAKE.awsAccessKey}"\nb="${FAKE.githubToken}"`);
    await runScan("zip", `a="${FAKE.awsAccessKey}"`); // resuelve el de GitHub
    const { outcome } = await runScan("zip", `a="${FAKE.awsAccessKey}"\nb="${FAKE.githubToken}"`);
    expect(outcome.ok && outcome.result).toMatchObject({ findingsNew: 0, findingsReopened: 1, autoResolved: 0 });
    expect(finding(FAKE.githubToken)?.status).toBe("active");
  });

  it.each(["snippet", "file"] as const)("un escaneo de %s NUNCA auto-resuelve", async (ingest) => {
    await runScan("zip", `a="${FAKE.awsAccessKey}"\nb="${FAKE.githubToken}"`);
    const { outcome } = await runScan(ingest, `a="${FAKE.awsAccessKey}"`);
    expect(outcome.ok && outcome.result?.autoResolved).toBe(0);
    expect(store.findings.every((f) => f.status === "active")).toBe(true);
  });

  it("un ZIP truncado (is_full_scan = false) no auto-resuelve", async () => {
    await runScan("zip", `a="${FAKE.awsAccessKey}"\nb="${FAKE.githubToken}"`);
    const { scanId, outcome } = await runScan("zip", `a="${FAKE.awsAccessKey}"`, {
      files_total: 3,
      files_skipped: 0,
      files_truncated: 2,
    });
    expect(outcome.ok && outcome.result).toMatchObject({ isFullScan: false, autoResolved: 0 });
    expect(store.findings.every((f) => f.status === "active")).toBe(true);
    expect(store.scans.find((s) => s.id === scanId)).toMatchObject({ isFullScan: false, filesTruncated: 2, filesTotal: 3 });
  });

  it("la auto-resolución no toca ignored ni false_positive", async () => {
    await runScan("zip", `a="${FAKE.awsAccessKey}"\nb="${FAKE.githubToken}"`);
    const gh = finding(FAKE.githubToken);
    if (!gh) throw new Error("sin hallazgo");
    store.setStatus(gh, "ignored", "decisión del usuario");
    await runScan("zip", "const limpio = true;");
    expect(gh.status).toBe("ignored");
    expect(finding(FAKE.awsAccessKey)?.status).toBe("resolved");
  });

  it("la auto-resolución solo afecta al proyecto del escaneo", async () => {
    const otherProject = store.addProject(USER);
    const created = await createScan(store, USER, { ingest: "zip", project_id: otherProject, source_name: "x" }, NOW);
    if (!created.ok) throw new Error(created.error);
    await processChunk(store, USER, created.scan.id, { chunk_index: 0, files: [{ path: "a", content: `k="${FAKE.slackToken}"` }] }, { pepper: PEPPER, now: NOW });
    await finalizeScan(store, USER, created.scan.id, FULL, NOW);

    await runScan("zip", "const limpio = true;");
    expect(finding(FAKE.slackToken)?.status).toBe("active");
  });

  it("es idempotente: finalizar dos veces no repite la auto-resolución ni el log", async () => {
    const { scanId } = await runScan("zip", `a="${FAKE.awsAccessKey}"`);
    const again = await finalizeScan(store, USER, scanId, FULL, NOW);
    expect(again).toEqual({ ok: true, alreadyCompleted: true, result: null });
    expect(store.logs.filter((l) => l.event === "scan_completed")).toHaveLength(1);
  });

  it("rechaza el escaneo de otro usuario y escaneos fallidos", async () => {
    const created = await createScan(store, USER, { ingest: "snippet", project_id: projectId }, NOW);
    if (!created.ok) throw new Error(created.error);
    expect(await finalizeScan(store, OTHER_USER, created.scan.id, FULL, NOW)).toEqual({ ok: false, error: "scan_not_found" });

    await store.failScan(USER, created.scan.id, "timeout", NOW);
    expect(await finalizeScan(store, USER, created.scan.id, FULL, NOW)).toEqual({ ok: false, error: "scan_not_open" });
  });

  it("finaliza un escaneo sin lotes (todos los archivos filtrados en el cliente)", async () => {
    const created = await createScan(store, USER, { ingest: "zip", project_id: projectId, source_name: "x" }, NOW);
    if (!created.ok) throw new Error(created.error);
    const outcome = await finalizeScan(store, USER, created.scan.id, { files_total: 5, files_skipped: 5, files_truncated: 0 }, NOW);
    expect(outcome.ok && outcome.result).toMatchObject({ isFullScan: true, findingsNew: 0 });
    expect(store.scans[0]).toMatchObject({ status: "completed", filesTotal: 5, filesSkipped: 5 });
  });

  it("después de finalizar ya no acepta lotes", async () => {
    const { scanId } = await runScan("zip", "x");
    const late = await processChunk(store, USER, scanId, { chunk_index: 1, files: [{ path: "b", content: "y" }] }, { pepper: PEPPER, now: NOW });
    expect(late).toEqual({ ok: false, error: "scan_not_accepting_chunks" });
  });
});

describe("shouldAutoResolve", () => {
  it.each([
    ["zip", true, true],
    ["github", true, true],
    ["zip", false, false],
    ["github", false, false],
    ["snippet", true, false],
    ["file", true, false],
  ] as const)("%s con is_full_scan=%s → %s", (ingest, full, expected) => {
    expect(shouldAutoResolve(ingest, full)).toBe(expected);
  });
});

describe("failOrphanScans", () => {
  let store: MemoryScanStore;
  let projectId: string;
  const minutes = (m: number) => new Date(NOW.getTime() + m * 60_000);
  const timeoutMinutes = SCAN_LIFECYCLE.orphanTimeoutMs / 60_000;

  beforeEach(() => {
    store = new MemoryScanStore();
    projectId = store.addProject(USER);
  });

  it("marca failed los escaneos sin actividad por más de 15 minutos", async () => {
    const created = await createScan(store, USER, { ingest: "snippet", project_id: projectId }, NOW);
    if (!created.ok) throw new Error(created.error);
    expect(await failOrphanScans(store, USER, minutes(timeoutMinutes - 1))).toBe(0);
    expect(await failOrphanScans(store, USER, minutes(timeoutMinutes + 1))).toBe(1);
    expect(store.scans[0]).toMatchObject({ status: "failed", errorMessage: ORPHAN_ERROR_MESSAGE });
    expect(store.logs.at(-1)).toMatchObject({ event: "scan_failed", level: "warn" });
  });

  it("la actividad reciente (un lote) mantiene vivo el escaneo", async () => {
    const created = await createScan(store, USER, { ingest: "zip", project_id: projectId, source_name: "x" }, NOW);
    if (!created.ok) throw new Error(created.error);
    store.clock = minutes(10);
    await processChunk(store, USER, created.scan.id, { chunk_index: 0, files: [{ path: "a", content: "x" }] }, { pepper: PEPPER, now: minutes(10) });
    expect(await failOrphanScans(store, USER, minutes(20))).toBe(0);
    expect(await failOrphanScans(store, USER, minutes(26))).toBe(1);
  });

  it("no toca escaneos terminados ni de otros usuarios", async () => {
    const created = await createScan(store, USER, { ingest: "snippet", project_id: projectId }, NOW);
    if (!created.ok) throw new Error(created.error);
    await finalizeScan(store, USER, created.scan.id, FULL, NOW);
    const otherProject = store.addProject(OTHER_USER);
    await createScan(store, OTHER_USER, { ingest: "snippet", project_id: otherProject }, NOW);

    expect(await failOrphanScans(store, USER, minutes(60))).toBe(0);
    expect(store.scans.map((s) => s.status)).toEqual(["completed", "queued"]);
  });

  it("crear un escaneo libera el cupo ocupado por huérfanos", async () => {
    await createScan(store, USER, { ingest: "snippet", project_id: projectId }, NOW);
    await createScan(store, USER, { ingest: "snippet", project_id: projectId }, NOW);
    store.clock = minutes(30);
    const created = await createScan(store, USER, { ingest: "snippet", project_id: projectId }, minutes(30));
    expect(created.ok).toBe(true);
    expect(store.scans.filter((s) => s.status === "failed")).toHaveLength(2);
  });
});

describe("finalizeSchema", () => {
  it("acepta conteos válidos y rechaza negativos o decimales", () => {
    expect(finalizeSchema.safeParse(FULL).success).toBe(true);
    expect(finalizeSchema.safeParse({ ...FULL, files_total: -1 }).success).toBe(false);
    expect(finalizeSchema.safeParse({ ...FULL, files_truncated: 0.5 }).success).toBe(false);
    expect(finalizeSchema.safeParse({ files_total: 1 }).success).toBe(false);
  });
});
