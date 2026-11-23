import { SCAN_LIMITS } from "../config";
import { hasBinaryExtension, hasNullByte, isIgnoredPath, utf8ByteLength } from "../engine/filters";
import { normalizeEntryPath } from "./paths";
import { buildBatches, prepareZipBatches, ZipRejectedError, type ScanBatch } from "./zip-client";

/**
 * Orquestación de un escaneo desde el navegador (decisiones técnicas, 3.1):
 * crea el escaneo, envía los lotes en orden y lo finaliza. GitHub solo se
 * crea: lo procesa el servidor. Módulo sin dependencias de React; `fetch`
 * llega inyectado para poder probarlo.
 */

export type ScanSource =
  | { mode: "snippet"; content: string }
  | { mode: "file"; name: string; bytes: Uint8Array }
  | { mode: "zip"; name: string; data: Blob | ArrayBuffer | Uint8Array }
  | { mode: "github"; repoUrl: string };

export type ScanPhase = "preparing" | "uploading" | "finalizing";

export interface ScanProgressUpdate {
  phase: ScanPhase;
  chunksSent: number;
  chunksTotal: number;
}

export interface OrchestratorDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  onProgress?: (update: ScanProgressUpdate) => void;
}

/** Error para mostrar al usuario (mensaje en español, sin datos sensibles). */
export class ScanClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ScanClientError";
  }
}

/** Reintentos por petición ante fallos transitorios (red, 429, 5xx). */
export const MAX_REQUEST_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;
const SNIPPET_PATH = "fragmento.txt";

interface Counts {
  files_total: number;
  files_skipped: number;
  files_truncated: number;
}

interface Prepared {
  create: Record<string, unknown>;
  batches: ScanBatch[];
  counts: Counts;
}

async function prepare(projectId: string, source: ScanSource): Promise<Prepared> {
  switch (source.mode) {
    case "snippet": {
      if (source.content.trim() === "") throw new ScanClientError("empty", "Pega el código que quieres analizar.");
      if (utf8ByteLength(source.content) > SCAN_LIMITS.maxFileBytes) {
        throw new ScanClientError("too_large", "El fragmento supera 1 MB. Súbelo como archivo o ZIP.");
      }
      const { batches } = buildBatches([{ path: SNIPPET_PATH, content: source.content }]);
      return {
        create: { ingest: "snippet", project_id: projectId },
        batches,
        counts: { files_total: 1, files_skipped: 0, files_truncated: 0 },
      };
    }
    case "file": {
      const path = normalizeEntryPath(source.name) ?? "archivo";
      if (source.bytes.length > SCAN_LIMITS.maxFileBytes) {
        throw new ScanClientError("too_large", "El archivo supera 1 MB.");
      }
      if (hasNullByte(source.bytes) || hasBinaryExtension(path) || isIgnoredPath(path)) {
        throw new ScanClientError(
          "unsupported_file",
          "Ese archivo no se analiza: es binario, un lockfile o un archivo generado.",
        );
      }
      const content = new TextDecoder("utf-8").decode(source.bytes);
      const { batches, oversized } = buildBatches([{ path, content }]);
      if (oversized > 0) throw new ScanClientError("too_large", "El archivo es demasiado grande para enviarse.");
      return {
        create: { ingest: "file", project_id: projectId, source_name: source.name },
        batches,
        counts: { files_total: 1, files_skipped: 0, files_truncated: 0 },
      };
    }
    case "zip": {
      try {
        const { batches, stats } = await prepareZipBatches(source.data);
        return {
          create: { ingest: "zip", project_id: projectId, source_name: source.name },
          batches,
          counts: {
            files_total: stats.filesTotal,
            files_skipped: stats.filesSkipped,
            files_truncated: stats.filesTruncated,
          },
        };
      } catch (error) {
        if (error instanceof ZipRejectedError) throw new ScanClientError(error.code, error.message);
        throw error;
      }
    }
    case "github":
      return {
        create: { ingest: "github", project_id: projectId, repo_url: source.repoUrl },
        batches: [],
        counts: { files_total: 0, files_skipped: 0, files_truncated: 0 },
      };
  }
}

/** POST JSON con reintentos en fallos transitorios. Devuelve el body de la respuesta. */
async function postJson(deps: OrchestratorDeps, url: string, body: unknown): Promise<Record<string, unknown>> {
  for (let attempt = 1; ; attempt += 1) {
    let response: Response;
    try {
      response = await deps.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      if (attempt >= MAX_REQUEST_ATTEMPTS) {
        throw new ScanClientError("network_error", "No hay conexión con el servidor. Intenta de nuevo.");
      }
      await deps.sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
      continue;
    }

    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return json;

    const retryable = response.status === 429 || response.status >= 500;
    const apiError = json.error as { code?: string; message?: string } | undefined;
    // 429 del rate limit de LEAT no se reintenta: el límite no cambia en segundos.
    if (!retryable || apiError?.code === "hourly_limit" || apiError?.code === "concurrent_limit" || attempt >= MAX_REQUEST_ATTEMPTS) {
      throw new ScanClientError(apiError?.code ?? `http_${response.status}`, apiError?.message ?? "Ocurrió un error inesperado.");
    }
    await deps.sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
  }
}

/** Ejecuta el escaneo completo y devuelve su id. */
export async function startScan(deps: OrchestratorDeps, projectId: string, source: ScanSource): Promise<string> {
  deps.onProgress?.({ phase: "preparing", chunksSent: 0, chunksTotal: 0 });
  const prepared = await prepare(projectId, source);

  const created = await postJson(deps, "/api/scans", prepared.create);
  const scanId = created.scan_id;
  if (typeof scanId !== "string") throw new ScanClientError("invalid_response", "Respuesta inesperada del servidor.");
  if (source.mode === "github") return scanId;

  const total = prepared.batches.length;
  deps.onProgress?.({ phase: "uploading", chunksSent: 0, chunksTotal: total });
  for (const [sent, batch] of prepared.batches.entries()) {
    await postJson(deps, `/api/scans/${scanId}/chunks`, { chunk_index: batch.chunkIndex, files: batch.files });
    deps.onProgress?.({ phase: "uploading", chunksSent: sent + 1, chunksTotal: total });
  }

  deps.onProgress?.({ phase: "finalizing", chunksSent: total, chunksTotal: total });
  await postJson(deps, `/api/scans/${scanId}/finalize`, prepared.counts);
  return scanId;
}
