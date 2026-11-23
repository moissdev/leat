import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { RATE_LIMITS } from "@/lib/config";
import { createScan } from "@/lib/scans/create";
import { createScanSchema } from "@/lib/scans/schemas";
import { MemoryScanStore } from "./memory-store";

const USER = randomUUID();
const OTHER_USER = randomUUID();
const NOW = new Date("2026-01-01T12:00:00Z");

describe("createScan", () => {
  let store: MemoryScanStore;
  let projectId: string;

  beforeEach(() => {
    store = new MemoryScanStore();
    projectId = store.addProject(USER);
  });

  it("crea un escaneo queued con el user_id de la sesión y registra el evento", async () => {
    const result = await createScan(store, USER, { ingest: "zip", project_id: projectId, source_name: "repo.zip" }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scan).toMatchObject({ userId: USER, projectId, ingest: "zip", status: "queued" });
    expect(store.scans[0]?.sourceRef).toBe("repo.zip");
    expect(store.logs.map((l) => l.event)).toEqual(["scan_created"]);
  });

  it("rechaza el proyecto de otro usuario", async () => {
    const foreign = store.addProject(OTHER_USER);
    const result = await createScan(store, USER, { ingest: "snippet", project_id: foreign }, NOW);
    expect(result).toEqual({ ok: false, error: "project_not_found" });
    expect(store.scans).toHaveLength(0);
  });

  it(`limita a ${RATE_LIMITS.maxConcurrentScans} escaneos en curso`, async () => {
    for (let i = 0; i < RATE_LIMITS.maxConcurrentScans; i += 1) {
      expect((await createScan(store, USER, { ingest: "snippet", project_id: projectId }, NOW)).ok).toBe(true);
    }
    const blocked = await createScan(store, USER, { ingest: "snippet", project_id: projectId }, NOW);
    expect(blocked).toEqual({ ok: false, error: "concurrent_limit" });
  });

  it(`limita a ${RATE_LIMITS.maxScansPerHour} escaneos por hora`, async () => {
    for (let i = 0; i < RATE_LIMITS.maxScansPerHour; i += 1) {
      const r = await createScan(store, USER, { ingest: "snippet", project_id: projectId }, NOW);
      expect(r.ok).toBe(true);
      const last = store.scans.at(-1);
      if (last) last.status = "completed"; // no cuenta como en curso
    }
    const blocked = await createScan(store, USER, { ingest: "snippet", project_id: projectId }, NOW);
    expect(blocked).toEqual({ ok: false, error: "hourly_limit" });
  });

  it("los escaneos de más de una hora no cuentan para el límite", async () => {
    store.clock = new Date(NOW.getTime() - 61 * 60 * 1000);
    for (let i = 0; i < RATE_LIMITS.maxScansPerHour; i += 1) {
      await createScan(store, USER, { ingest: "snippet", project_id: projectId }, store.clock);
      const last = store.scans.at(-1);
      if (last) last.status = "completed";
    }
    store.clock = NOW;
    expect((await createScan(store, USER, { ingest: "snippet", project_id: projectId }, NOW)).ok).toBe(true);
  });

  it("el límite es por usuario", async () => {
    const otherProject = store.addProject(OTHER_USER);
    for (let i = 0; i < RATE_LIMITS.maxConcurrentScans; i += 1) {
      await createScan(store, OTHER_USER, { ingest: "snippet", project_id: otherProject }, NOW);
    }
    expect((await createScan(store, USER, { ingest: "snippet", project_id: projectId }, NOW)).ok).toBe(true);
  });
});

describe("createScanSchema", () => {
  const project_id = randomUUID();

  it("acepta los cuatro modos de ingesta", () => {
    expect(createScanSchema.safeParse({ ingest: "snippet", project_id }).success).toBe(true);
    expect(createScanSchema.safeParse({ ingest: "file", project_id, source_name: "a.ts" }).success).toBe(true);
    expect(createScanSchema.safeParse({ ingest: "zip", project_id, source_name: "a.zip" }).success).toBe(true);
    const gh = createScanSchema.safeParse({ ingest: "github", project_id, repo_url: "https://github.com/a/b" });
    expect(gh.success && gh.data.ingest === "github" && gh.data.repo_url.owner).toBe("a");
  });

  it("guarda solo el nombre del archivo, sin la ruta", () => {
    const r = createScanSchema.parse({ ingest: "zip", project_id, source_name: "C:\\Users\\yo\\repo.zip" });
    expect(r.ingest === "zip" && r.source_name).toBe("repo.zip");
  });

  it.each([
    [{ ingest: "snippet", project_id: "no-uuid" }],
    [{ ingest: "zip", project_id }],
    [{ ingest: "file", project_id, source_name: "a\nb.ts" }],
    [{ ingest: "github", project_id, repo_url: "https://evil.example/a/b" }],
    [{ ingest: "ftp", project_id }],
  ])("rechaza %j", (input) => {
    expect(createScanSchema.safeParse(input).success).toBe(false);
  });

  it("ignora un user_id en el body (no forma parte del esquema)", () => {
    const parsed = createScanSchema.parse({ ingest: "snippet", project_id, user_id: OTHER_USER });
    expect("user_id" in parsed).toBe(false);
  });
});
