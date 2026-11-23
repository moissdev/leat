import { Readable, Transform } from "node:stream";
import { createGunzip } from "node:zlib";
import { extract, type Header } from "tar-stream";
import { GITHUB_LIMITS, SCAN_LIMITS, ZIP_LIMITS } from "../config";
import { hasBinaryExtension, hasNullByte, isIgnoredPath } from "../engine/filters";
import { completeScan, type FinalizeResult } from "../scans/finalize";
import type { ScanStore } from "../scans/persist";
import { processScanChunk } from "../scans/process-chunk";
import type { GithubRepoRef } from "./github-url";
import { normalizeEntryPath } from "./paths";

/**
 * Escaneo de repositorios PÚBLICOS de GitHub, orquestado por el servidor
 * (decisiones técnicas, sección 3.2):
 *
 * 1. Metadatos con el token de la aplicación: rama por defecto, visibilidad y
 *    commit SHA (se guarda en `scans.source_ref`).
 * 2. Descarga del tarball en streaming (gzip → tar), sin escribir en disco.
 * 3. Filtros y límites por entrada; los archivos se procesan en lotes con el
 *    mismo núcleo que la API de lotes.
 * 4. Guarda de tiempo (~240 s) y tope de 50 MB: al alcanzarlos se detiene, se
 *    marca truncado y se cierra el escaneo con `is_full_scan = false`.
 */

export interface GithubRepoMetadata {
  defaultBranch: string;
  isPrivate: boolean;
}

/** Acceso a GitHub (inyectable para pruebas). */
export interface GithubClient {
  /** null si el repositorio no existe o no es accesible. */
  getRepo(owner: string, repo: string): Promise<GithubRepoMetadata | null>;
  getHeadSha(owner: string, repo: string, branch: string): Promise<string>;
  /** Tarball .tar.gz del commit. */
  openTarball(owner: string, repo: string, sha: string, signal: AbortSignal): Promise<Readable>;
}

export interface GithubScanLimits {
  maxRepoBytes: number;
  timeGuardMs: number;
  maxFileBytes: number;
  maxFiles: number;
  batchBytes: number;
}

export const DEFAULT_GITHUB_SCAN_LIMITS: GithubScanLimits = {
  maxRepoBytes: GITHUB_LIMITS.maxRepoBytes,
  timeGuardMs: GITHUB_LIMITS.timeGuardMs,
  maxFileBytes: SCAN_LIMITS.maxFileBytes,
  maxFiles: SCAN_LIMITS.maxFilesPerScan,
  batchBytes: ZIP_LIMITS.maxChunkBytes,
};

export interface GithubScanDeps {
  store: ScanStore;
  github: GithubClient;
  pepper: string;
  /** Reloj en milisegundos (inyectable para probar la guarda de tiempo). */
  clock: () => number;
  limits?: GithubScanLimits;
}

export type GithubFailureCode =
  | "repo_not_found"
  | "repo_not_public"
  | "github_unavailable"
  | "tarball_error"
  | "internal_error";

export type GithubScanOutcome =
  | { status: "completed"; finalize: FinalizeResult; sha: string }
  | { status: "failed"; code: GithubFailureCode }
  | { status: "skipped" };

/** Error controlado del acceso a GitHub (sin URLs ni tokens en el mensaje). */
export class GithubAccessError extends Error {
  constructor(readonly code: GithubFailureCode) {
    super(`Fallo de GitHub: ${code}`);
    this.name = "GithubAccessError";
  }
}

const MAX_PATH_LENGTH = 500; // límite de `finding_occurrences.file_path`

/**
 * Cuenta bytes del tarball comprimido. Al superar el tope deja de pasar datos
 * y cierra su salida de forma ordenada: lo ya recibido se sigue procesando.
 */
class ByteBudget extends Transform {
  bytes = 0;
  exceeded = false;
  constructor(private readonly max: number) {
    super();
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (this.exceeded) {
      callback(); // se descarta todo lo que llega después del tope
      return;
    }
    const remaining = this.max - this.bytes;
    this.bytes += chunk.length;
    if (chunk.length > remaining) {
      this.exceeded = true;
      if (remaining > 0) this.push(chunk.subarray(0, remaining));
      this.push(null);
      callback();
      return;
    }
    this.push(chunk);
    callback();
  }
}

/** Quita el directorio raíz del tarball (`owner-repo-sha/`). */
function stripRoot(name: string): string | null {
  const slash = name.indexOf("/");
  if (slash < 0) return null;
  return normalizeEntryPath(name.slice(slash + 1));
}

/**
 * Lee una entrada completa; si supera `max` sigue drenándola (sin guardarla)
 * para no cortar el stream del tar, y devuelve null.
 */
async function readEntry(entry: AsyncIterable<unknown>, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const raw of entry) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
    total += chunk.length;
    if (total <= max) chunks.push(chunk);
  }
  return total > max ? null : Buffer.concat(chunks);
}

async function failWith(
  deps: GithubScanDeps,
  userId: string,
  scanId: string,
  code: GithubFailureCode,
): Promise<GithubScanOutcome> {
  if (await deps.store.failScan(userId, scanId, code, new Date(deps.clock()))) {
    await deps.store.logScanEvent(userId, scanId, {
      level: "error",
      event: "scan_failed",
      metadata: { reason: code },
    });
  }
  return { status: "failed", code };
}

/** Ejecuta el escaneo completo. Nunca lanza: los errores dejan el escaneo en `failed`. */
export async function runGithubScan(
  deps: GithubScanDeps,
  userId: string,
  scanId: string,
  ref: GithubRepoRef,
): Promise<GithubScanOutcome> {
  const limits = deps.limits ?? DEFAULT_GITHUB_SCAN_LIMITS;
  const startedAt = deps.clock();
  const { store } = deps;

  try {
    const initial = await store.getScan(userId, scanId);
    if (!initial || initial.ingest !== "github" || initial.status !== "queued") return { status: "skipped" };
    await store.markScanRunning(userId, scanId, new Date(startedAt));

    // ── 1. Metadatos
    const repo = await deps.github.getRepo(ref.owner, ref.repo);
    if (!repo) return failWith(deps, userId, scanId, "repo_not_found");
    if (repo.isPrivate) return failWith(deps, userId, scanId, "repo_not_public");
    const sha = await deps.github.getHeadSha(ref.owner, ref.repo, repo.defaultBranch);
    await store.setScanSourceRef(userId, scanId, sha);
    await store.logScanEvent(userId, scanId, {
      level: "info",
      event: "github_metadata",
      metadata: { owner: ref.owner, repo: ref.repo, branch: repo.defaultBranch, commit: sha },
    });

    // ── 2. Descarga y extracción en streaming
    const controller = new AbortController();
    const budget = new ByteBudget(limits.maxRepoBytes);
    const tar = extract();
    const source = await deps.github.openTarball(ref.owner, ref.repo, sha, controller.signal);
    const gunzip = createGunzip();
    let streamError: Error | null = null;
    const onError = (error: Error) => {
      if (budget.exceeded) {
        // gzip incompleto por el corte: el tar entrega lo que ya tiene y termina.
        tar.end(Buffer.alloc(0));
        return;
      }
      streamError ??= error;
      tar.destroy(error);
    };
    source.on("error", onError);
    budget.on("error", onError);
    gunzip.on("error", onError);
    source.pipe(budget).pipe(gunzip).pipe(tar);

    let filesTotal = 0;
    let filesSkipped = 0;
    let filesTruncated = 0;
    let filesQueued = 0;
    let timeExceeded = false;
    let chunkIndex = 0;
    let batch: { path: string; content: string }[] = [];
    let batchBytes = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      const scan = await store.getScan(userId, scanId);
      if (!scan) throw new GithubAccessError("internal_error");
      await processScanChunk(store, userId, scan, { chunk_index: chunkIndex, files: batch }, {
        pepper: deps.pepper,
        now: new Date(deps.clock()),
      });
      chunkIndex += 1;
      batch = [];
      batchBytes = 0;
    };

    try {
      for await (const entry of tar) {
        const header: Header = entry.header;
        if (deps.clock() - startedAt > limits.timeGuardMs) {
          timeExceeded = true;
          break;
        }
        if (header.type !== "file" && header.type !== "contiguous-file") {
          if (header.type !== "directory") filesSkipped += 1; // enlaces, dispositivos…
          entry.resume();
          continue;
        }

        filesTotal += 1;
        const path = stripRoot(header.name);
        if (!path || isIgnoredPath(path) || hasBinaryExtension(path)) {
          filesSkipped += 1;
          entry.resume();
          continue;
        }
        if (header.size > limits.maxFileBytes || filesQueued >= limits.maxFiles || path.length > MAX_PATH_LENGTH) {
          filesTruncated += 1;
          entry.resume();
          continue;
        }

        const bytes = await readEntry(entry, limits.maxFileBytes);
        if (!bytes) {
          filesTruncated += 1;
          continue;
        }
        if (hasNullByte(bytes)) {
          filesSkipped += 1;
          continue;
        }

        batch.push({ path, content: new TextDecoder("utf-8").decode(bytes) });
        batchBytes += bytes.length;
        filesQueued += 1;
        if (batchBytes >= limits.batchBytes || batch.length >= 500) await flush();
      }
    } catch (error) {
      // Tras el corte por tamaño, el final abrupto del tar es esperado.
      if (!budget.exceeded) {
        throw error instanceof GithubAccessError ? error : new GithubAccessError("tarball_error");
      }
    } finally {
      controller.abort();
      source.destroy();
    }

    if (streamError && !budget.exceeded) throw new GithubAccessError("tarball_error");
    await flush();

    // ── 3. Cierre: lo que quedó sin leer cuenta como truncado (al menos 1).
    if (budget.exceeded || timeExceeded) {
      filesTruncated += 1;
      await store.logScanEvent(userId, scanId, {
        level: "warn",
        event: "github_truncated",
        metadata: { reason: budget.exceeded ? "repo_too_large" : "time_guard", bytes_read: budget.bytes },
      });
    }

    const scan = await store.getScan(userId, scanId);
    if (!scan) return { status: "skipped" };
    const finalize = await completeScan(
      store,
      userId,
      scan,
      { filesTotal, filesSkipped, filesTruncated },
      new Date(deps.clock()),
    );
    return { status: "completed", finalize, sha };
  } catch (error) {
    const code = error instanceof GithubAccessError ? error.code : "internal_error";
    if (code === "internal_error") {
      console.error("[github] error interno", { name: error instanceof Error ? error.name : typeof error });
    }
    return failWith(deps, userId, scanId, code);
  }
}
