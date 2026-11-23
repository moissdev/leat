import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { pack } from "tar-stream";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_GITHUB_SCAN_LIMITS,
  GithubAccessError,
  runGithubScan,
  type GithubClient,
  type GithubScanDeps,
} from "@/lib/ingest/github";
import { createScan } from "@/lib/scans/create";
import { createScanSchema } from "@/lib/scans/schemas";
import { alnum, FAKE } from "../fixtures/secrets";
import { MemoryScanStore } from "../scans/memory-store";

const USER = randomUUID();
const PEPPER = alnum(64, 50);
const SHA = "a".repeat(40);
const ROOT = `octo-demo-${SHA.slice(0, 7)}`;

type TarEntry = { name: string; content?: string | Buffer; type?: "file" | "symlink" | "directory"; linkname?: string };

/** Genera un .tar.gz en memoria con el directorio raíz que usa GitHub. */
async function makeTarball(entries: TarEntry[]): Promise<Buffer> {
  const p = pack();
  const chunks: Buffer[] = [];
  p.on("data", (chunk: unknown) => {
    chunks.push(Buffer.from(chunk as Uint8Array));
  });
  const done = new Promise<void>((resolve) => p.on("end", () => resolve()));
  p.entry({ name: `${ROOT}/`, type: "directory" });
  for (const e of entries) {
    const name = `${ROOT}/${e.name}`;
    if (e.type === "symlink") p.entry({ name, type: "symlink", linkname: e.linkname ?? "x" });
    else if (e.type === "directory") p.entry({ name, type: "directory" });
    else p.entry({ name }, e.content ?? "");
  }
  p.finalize();
  await done;
  return gzipSync(Buffer.concat(chunks));
}

class FakeGithub implements GithubClient {
  tarball: Buffer = Buffer.alloc(0);
  repo: { defaultBranch: string; isPrivate: boolean } | null = { defaultBranch: "main", isPrivate: false };
  shaError: GithubAccessError | null = null;
  async getRepo() {
    return this.repo;
  }
  async getHeadSha() {
    if (this.shaError) throw this.shaError;
    return SHA;
  }
  async openTarball() {
    // Trozos pequeños para ejercitar el streaming.
    const data = this.tarball;
    return Readable.from(
      (function* () {
        for (let i = 0; i < data.length; i += 1024) yield data.subarray(i, i + 1024);
      })(),
    );
  }
}

describe("runGithubScan", () => {
  let store: MemoryScanStore;
  let github: FakeGithub;
  let projectId: string;
  let deps: GithubScanDeps;

  async function newGithubScan(): Promise<string> {
    const input = createScanSchema.parse({ ingest: "github", project_id: projectId, repo_url: "https://github.com/octo/demo" });
    const created = await createScan(store, USER, input, new Date());
    if (!created.ok) throw new Error(created.error);
    return created.scan.id;
  }
  const ref = { owner: "octo", repo: "demo", url: "https://github.com/octo/demo" };
  const scanRow = (id: string) => store.scans.find((s) => s.id === id);

  beforeEach(() => {
    store = new MemoryScanStore();
    github = new FakeGithub();
    projectId = store.addProject(USER);
    deps = { store, github, pepper: PEPPER, clock: () => Date.now() };
  });

  it("analiza el repo completo, guarda el commit SHA y cierra con is_full_scan", async () => {
    github.tarball = await makeTarball([
      { name: "src/config.ts", content: `export const key = "${FAKE.awsAccessKey}";` },
      { name: "src/app.ts", content: "export const ok = true;" },
      { name: "README.md", content: "# demo" },
    ]);
    const scanId = await newGithubScan();
    const outcome = await runGithubScan(deps, USER, scanId, ref);

    expect(outcome.status).toBe("completed");
    expect(scanRow(scanId)).toMatchObject({ status: "completed", sourceRef: SHA, isFullScan: true, filesScanned: 3, filesTotal: 3 });
    expect(store.findings).toHaveLength(1);
    expect(store.occurrences[0]?.filePath).toBe("src/config.ts"); // sin el directorio raíz
    expect(store.logs.map((l) => l.event)).toEqual(["scan_created", "github_metadata", "chunk_processed", "scan_completed"]);
  });

  it("omite dependencias, binarios y enlaces simbólicos; trunca archivos grandes", async () => {
    github.tarball = await makeTarball([
      { name: "node_modules/pkg/index.js", content: `k="${FAKE.awsAccessKey}"` },
      { name: "public/logo.png", content: randomBytes(64) },
      { name: "data.bin", content: Buffer.from([1, 0, 2]) },
      { name: "link", type: "symlink", linkname: "/etc/passwd" },
      { name: "big.txt", content: "x".repeat(DEFAULT_GITHUB_SCAN_LIMITS.maxFileBytes + 1) },
      { name: "src/ok.ts", content: "1" },
    ]);
    const scanId = await newGithubScan();
    await runGithubScan(deps, USER, scanId, ref);
    expect(store.findings).toHaveLength(0);
    expect(scanRow(scanId)).toMatchObject({ filesScanned: 1, filesSkipped: 4, filesTruncated: 1, isFullScan: false });
  });

  it("procesa en varios lotes según el tamaño", async () => {
    github.tarball = await makeTarball(
      Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.txt`, content: "y".repeat(1000) })),
    );
    const scanId = await newGithubScan();
    await runGithubScan({ ...deps, limits: { ...DEFAULT_GITHUB_SCAN_LIMITS, batchBytes: 2500 } }, USER, scanId, ref);
    expect(scanRow(scanId)).toMatchObject({ chunksReceived: 2, filesScanned: 6, isFullScan: true });
  });

  it("al superar el tamaño máximo del tarball se detiene y marca truncado sin fallar", async () => {
    const files = Array.from({ length: 30 }, (_, i) => ({
      name: `f${i}.txt`,
      content: i === 0 ? `k="${FAKE.githubToken}"` : randomBytes(3000).toString("base64"),
    }));
    github.tarball = await makeTarball(files);
    const scanId = await newGithubScan();
    const outcome = await runGithubScan({ ...deps, limits: { ...DEFAULT_GITHUB_SCAN_LIMITS, maxRepoBytes: 20_000 } }, USER, scanId, ref);
    expect(outcome.status).toBe("completed");
    const scan = scanRow(scanId);
    expect(scan).toMatchObject({ status: "completed", isFullScan: false });
    expect(scan?.filesScanned).toBeLessThan(30);
    // Lo leído antes del corte sí se analiza (el relleno aleatorio aporta hallazgos de entropía).
    expect(store.findings.map((f) => f.secretType)).toContain("github_token");
    expect(store.logs.some((l) => l.event === "github_truncated")).toBe(true);
  });

  it("la guarda de tiempo detiene el análisis y marca truncado", async () => {
    github.tarball = await makeTarball(Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.ts`, content: "1" })));
    let now = 0;
    const scanId = await newGithubScan();
    await runGithubScan(
      { ...deps, clock: () => (now += 100), limits: { ...DEFAULT_GITHUB_SCAN_LIMITS, timeGuardMs: 450 } },
      USER,
      scanId,
      ref,
    );
    const scan = scanRow(scanId);
    expect(scan).toMatchObject({ status: "completed", isFullScan: false });
    expect(scan?.filesScanned).toBeLessThan(10);
    expect(store.logs.find((l) => l.event === "github_truncated")?.metadata).toMatchObject({ reason: "time_guard" });
  });

  it("auto-resuelve con un escaneo completo de GitHub", async () => {
    github.tarball = await makeTarball([{ name: "a.ts", content: `a="${FAKE.awsAccessKey}"\nb="${FAKE.slackToken}"` }]);
    await runGithubScan(deps, USER, await newGithubScan(), ref);
    github.tarball = await makeTarball([{ name: "a.ts", content: `a="${FAKE.awsAccessKey}"` }]);
    const outcome = await runGithubScan(deps, USER, await newGithubScan(), ref);
    expect(outcome.status === "completed" && outcome.finalize.ok && outcome.finalize.result?.autoResolved).toBe(1);
    expect(store.findings.map((f) => f.status).sort()).toEqual(["active", "resolved"]);
  });

  it.each([
    ["repo inexistente", (g: FakeGithub): void => { g.repo = null; }, "repo_not_found"],
    ["repo privado", (g: FakeGithub): void => { g.repo = { defaultBranch: "main", isPrivate: true }; }, "repo_not_public"],
    ["API no disponible", (g: FakeGithub): void => { g.shaError = new GithubAccessError("github_unavailable"); }, "github_unavailable"],
    ["tarball corrupto", (g: FakeGithub): void => { g.tarball = Buffer.from("esto no es gzip"); }, "tarball_error"],
  ] as const)("%s → failed con motivo %s", async (_label: string, arrange: (g: FakeGithub) => void, code: string) => {
    arrange(github);
    const scanId = await newGithubScan();
    const outcome = await runGithubScan(deps, USER, scanId, ref);
    expect(outcome).toEqual({ status: "failed", code });
    expect(scanRow(scanId)).toMatchObject({ status: "failed", errorMessage: code });
    expect(store.logs.at(-1)).toMatchObject({ event: "scan_failed", metadata: { reason: code } });
  });

  it("no hace nada si el escaneo no está en cola o no es de GitHub", async () => {
    const scanId = await newGithubScan();
    const scan = scanRow(scanId);
    if (scan) scan.status = "running";
    expect(await runGithubScan(deps, USER, scanId, ref)).toEqual({ status: "skipped" });

    const snippet = await createScan(store, USER, { ingest: "snippet", project_id: projectId }, new Date());
    if (!snippet.ok) throw new Error(snippet.error);
    expect(await runGithubScan(deps, USER, snippet.scan.id, ref)).toEqual({ status: "skipped" });
  });

  it("nada de lo persistido contiene texto plano", async () => {
    github.tarball = await makeTarball([
      { name: "a.ts", content: `const a = "${FAKE.awsAccessKey}"; const s = "${FAKE.stripeLiveKey}";` },
      { name: "b.env", content: `DATABASE_URL=postgres://u:${FAKE.dbPassword}@h/db` },
    ]);
    await runGithubScan(deps, USER, await newGithubScan(), ref);
    const persisted = JSON.stringify({ scans: store.scans, findings: store.findings, occurrences: store.occurrences, logs: store.logs });
    expect(store.findings).toHaveLength(3);
    for (const secret of [FAKE.awsAccessKey, FAKE.stripeLiveKey, FAKE.dbPassword]) {
      expect(persisted.includes(secret)).toBe(false);
    }
  });
});
