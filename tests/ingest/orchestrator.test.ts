import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { MAX_REQUEST_ATTEMPTS, ScanClientError, startScan, type OrchestratorDeps, type ScanSource } from "@/lib/ingest/orchestrator";
import { FAKE } from "../fixtures/secrets";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SCAN = "22222222-2222-4222-8222-222222222222";

type Reply = Response | Error;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** fetch falso: responde según la ruta y registra cada llamada. */
function setup(routes: Record<string, Reply[]> = {}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const sleeps: number[] = [];
  const progress: string[] = [];
  const queues = new Map(Object.entries(routes).map(([k, v]) => [k, [...v]]));
  const deps: OrchestratorDeps = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      const key = url.endsWith("/chunks") ? "chunks" : url.endsWith("/finalize") ? "finalize" : "create";
      const next = queues.get(key)?.shift();
      if (next instanceof Error) throw next;
      if (next) return next;
      return key === "create" ? json(201, { scan_id: SCAN, status: "queued" }) : json(200, { ok: true });
    }) as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    onProgress: (u) => progress.push(`${u.phase}:${u.chunksSent}/${u.chunksTotal}`),
  };
  return { deps, calls, sleeps, progress };
}

async function makeZip(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

describe("startScan", () => {
  it("snippet: crea, envía un lote y finaliza con los conteos", async () => {
    const { deps, calls, progress } = setup();
    const id = await startScan(deps, PROJECT, { mode: "snippet", content: `k = "${FAKE.awsAccessKey}"` });
    expect(id).toBe(SCAN);
    expect(calls.map((c) => c.url)).toEqual(["/api/scans", `/api/scans/${SCAN}/chunks`, `/api/scans/${SCAN}/finalize`]);
    expect(calls[0]?.body).toEqual({ ingest: "snippet", project_id: PROJECT });
    expect(calls[1]?.body).toMatchObject({ chunk_index: 0, files: [{ path: "fragmento.txt" }] });
    expect(calls[2]?.body).toEqual({ files_total: 1, files_skipped: 0, files_truncated: 0 });
    expect(progress).toEqual(["preparing:0/0", "uploading:0/1", "uploading:1/1", "finalizing:1/1"]);
  });

  it("ZIP: envía los lotes en orden y finaliza con las estadísticas de la ingesta", async () => {
    const { deps, calls } = setup();
    const data = await makeZip({ "src/a.ts": "const a = 1;", "node_modules/x.js": "1", "README.md": "# hola" });
    await startScan(deps, PROJECT, { mode: "zip", name: "repo.zip", data });
    expect(calls[0]?.body).toEqual({ ingest: "zip", project_id: PROJECT, source_name: "repo.zip" });
    expect(calls.at(-1)?.body).toEqual({ files_total: 3, files_skipped: 1, files_truncated: 0 });
  });

  it("un ZIP inválido falla ANTES de crear el escaneo (no gasta cupo)", async () => {
    const { deps, calls } = setup();
    await expect(
      startScan(deps, PROJECT, { mode: "zip", name: "x.zip", data: new TextEncoder().encode("no es zip") }),
    ).rejects.toMatchObject({ code: "invalid_zip" });
    expect(calls).toHaveLength(0);
  });

  it("GitHub: solo crea el escaneo (lo procesa el servidor)", async () => {
    const { deps, calls } = setup();
    await startScan(deps, PROJECT, { mode: "github", repoUrl: "https://github.com/octocat/Hello-World" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ ingest: "github", project_id: PROJECT, repo_url: "https://github.com/octocat/Hello-World" });
  });

  it.each<[string, ScanSource, string]>([
    ["snippet vacío", { mode: "snippet", content: "   " }, "empty"],
    ["snippet de más de 1 MB", { mode: "snippet", content: "x".repeat(1024 * 1024 + 1) }, "too_large"],
    ["archivo binario", { mode: "file", name: "a.txt", bytes: new Uint8Array([1, 0, 2]) }, "unsupported_file"],
    ["lockfile", { mode: "file", name: "package-lock.json", bytes: new TextEncoder().encode("{}") }, "unsupported_file"],
    ["archivo de más de 1 MB", { mode: "file", name: "a.txt", bytes: new Uint8Array(1024 * 1024 + 1) }, "too_large"],
  ])("rechaza en el cliente: %s", async (_label, source, code) => {
    const { deps, calls } = setup();
    await expect(startScan(deps, PROJECT, source)).rejects.toMatchObject({ code });
    expect(calls).toHaveLength(0);
  });

  it("reintenta fallos transitorios (red y 5xx) con backoff", async () => {
    const { deps, calls, sleeps } = setup({ chunks: [new Error("offline"), json(502, {})] });
    await startScan(deps, PROJECT, { mode: "snippet", content: "const a = 1;" });
    expect(calls.filter((c) => c.url.endsWith("/chunks"))).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it(`se rinde tras ${MAX_REQUEST_ATTEMPTS} intentos`, async () => {
    const { deps } = setup({ finalize: [json(500, {}), json(500, {}), json(500, {})] });
    await expect(startScan(deps, PROJECT, { mode: "snippet", content: "x" })).rejects.toBeInstanceOf(ScanClientError);
  });

  it("no reintenta errores definitivos y muestra el mensaje de la API", async () => {
    const { deps, calls } = setup({
      create: [json(429, { error: { code: "concurrent_limit", message: "Ya tienes el máximo de escaneos en curso." } })],
    });
    await expect(startScan(deps, PROJECT, { mode: "snippet", content: "x" })).rejects.toMatchObject({
      code: "concurrent_limit",
      message: "Ya tienes el máximo de escaneos en curso.",
    });
    expect(calls).toHaveLength(1);
  });
});
