import JSZip from "jszip";
import { SCAN_LIMITS, ZIP_LIMITS } from "../config";
import { normalizeEntryPath } from "./paths";
import { getSkipReason, hasBinaryExtension, hasNullByte, isIgnoredPath, utf8ByteLength } from "../engine/filters";

/**
 * Ingesta de ZIP en el navegador (decisiones técnicas, secciones 3.1, 3.3 y 9).
 *
 * Descomprime con JSZip, filtra y arma lotes ≤ 3 MB para
 * `POST /api/scans/[id]/chunks`. El código nunca sale del navegador sin
 * pasar por estos filtros, y nada se escribe en disco.
 *
 * - Zip slip: una entrada con ruta absoluta o `..` rechaza el ZIP completo.
 * - Zip bomb: la descompresión se cuenta en streaming (no se confía en las
 *   cabeceras); se corta al superar el límite total o por archivo, y se
 *   descartan entradas con relación de compresión anómala.
 * - Límites: al excederlos no se falla; lo sobrante se cuenta en
 *   `filesTruncated` e `isFullScan` queda en false.
 */

export { normalizeEntryPath };

export interface IngestFile {
  path: string;
  content: string;
}

export interface ScanBatch {
  chunkIndex: number;
  files: IngestFile[];
  /** Tamaño aproximado del body JSON del lote, en bytes UTF-8. */
  bytes: number;
}

export interface IngestStats {
  /** Archivos (no directorios) encontrados en la entrada. */
  filesTotal: number;
  /** Archivos que irán en algún lote. */
  filesIncluded: number;
  /** Ignorados por ruta o por ser binarios (no cuentan como truncado). */
  filesSkipped: number;
  /** Omitidos por exceder un límite. */
  filesTruncated: number;
  isFullScan: boolean;
}

export interface IngestResult {
  batches: ScanBatch[];
  stats: IngestStats;
}

export type ZipRejectionCode = "invalid_zip" | "unsafe_path" | "too_many_entries";

/** El ZIP completo se rechaza; el mensaje es apto para mostrarse al usuario. */
export class ZipRejectedError extends Error {
  constructor(
    readonly code: ZipRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = "ZipRejectedError";
  }
}

/** Límites aplicables a la ingesta; por defecto, los de `config.ts`. */
export interface IngestLimits {
  maxFileBytes: number;
  maxFiles: number;
  maxTextBytes: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
  maxEntries: number;
  maxChunkBytes: number;
}

export const DEFAULT_INGEST_LIMITS: IngestLimits = {
  maxFileBytes: SCAN_LIMITS.maxFileBytes,
  maxFiles: SCAN_LIMITS.maxFilesPerScan,
  maxTextBytes: SCAN_LIMITS.maxScanTextBytes,
  maxUncompressedBytes: ZIP_LIMITS.maxUncompressedBytes,
  maxCompressionRatio: ZIP_LIMITS.maxCompressionRatio,
  maxEntries: ZIP_LIMITS.maxEntries,
  maxChunkBytes: ZIP_LIMITS.maxChunkBytes,
};

/** Bytes que añade el envoltorio JSON de un lote: `{"chunk_index":N,"files":[…]}`. */
const BATCH_OVERHEAD_BYTES = 64;
/** Tipo de archivo "enlace simbólico" en los permisos Unix. */
const UNIX_SYMLINK = 0o120000;
const UNIX_FILE_TYPE_MASK = 0o170000;

/** Tamaño serializado de un archivo dentro del body JSON. */
function serializedBytes(file: IngestFile): number {
  return utf8ByteLength(JSON.stringify(file)) + 1; // +1 por la coma separadora
}

/**
 * Agrupa archivos en lotes cuyo body JSON no exceda `maxChunkBytes`.
 * Un archivo que por sí solo no cabe en un lote se omite y se cuenta.
 */
export function buildBatches(
  files: readonly IngestFile[],
  maxBytes: number = ZIP_LIMITS.maxChunkBytes,
): { batches: ScanBatch[]; oversized: number } {
  const batches: ScanBatch[] = [];
  let current: ScanBatch | null = null;
  let oversized = 0;

  for (const file of files) {
    const size = serializedBytes(file);
    if (size + BATCH_OVERHEAD_BYTES > maxBytes) {
      oversized += 1;
      continue;
    }
    if (!current || current.bytes + size > maxBytes) {
      current = { chunkIndex: batches.length, files: [], bytes: BATCH_OVERHEAD_BYTES };
      batches.push(current);
    }
    current.files.push(file);
    current.bytes += size;
  }

  return { batches, oversized };
}

/** Lectura de metadatos internos de JSZip (no tipados); solo para la relación de compresión. */
function declaredSizes(entry: JSZip.JSZipObject): { compressed: number; uncompressed: number } | null {
  const data = (entry as unknown as { _data?: { compressedSize?: unknown; uncompressedSize?: unknown } })._data;
  const compressed = data?.compressedSize;
  const uncompressed = data?.uncompressedSize;
  return typeof compressed === "number" && typeof uncompressed === "number"
    ? { compressed, uncompressed }
    : null;
}

/** Stream interno de JSZip (existe en `ZipObject`, pero no está en sus tipos públicos). */
interface EntryStream {
  on(event: "data", listener: (chunk: Uint8Array) => void): EntryStream;
  on(event: "error", listener: (error: Error) => void): EntryStream;
  on(event: "end", listener: () => void): EntryStream;
  pause(): EntryStream;
  resume(): EntryStream;
}

function openEntryStream(entry: JSZip.JSZipObject): EntryStream {
  return (entry as unknown as { internalStream(type: "uint8array"): EntryStream }).internalStream(
    "uint8array",
  );
}

type ReadOutcome =
  | { kind: "ok"; bytes: Uint8Array }
  | { kind: "file_too_large" }
  | { kind: "budget_exceeded" };

/**
 * Descomprime una entrada contando bytes reales en streaming y se detiene en
 * cuanto supera el límite por archivo o el presupuesto total restante.
 */
function readEntryBounded(
  entry: JSZip.JSZipObject,
  remainingBudget: number,
  maxFileBytes: number,
): Promise<ReadOutcome> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const stream = openEntryStream(entry);

    const finish = (outcome: ReadOutcome) => {
      if (settled) return;
      settled = true;
      stream.pause();
      resolve(outcome);
    };

    stream
      .on("data", (chunk: Uint8Array) => {
        if (settled) return;
        total += chunk.length;
        if (total > remainingBudget) return finish({ kind: "budget_exceeded" });
        if (total > maxFileBytes) return finish({ kind: "file_too_large" });
        chunks.push(chunk);
      })
      .on("error", (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      })
      .on("end", () => {
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        finish({ kind: "ok", bytes });
      })
      .resume();
  });
}

/**
 * Lee un ZIP, aplica filtros y límites, y devuelve los lotes listos para enviar.
 * Lanza `ZipRejectedError` si el archivo no es un ZIP válido o es malicioso.
 */
export async function prepareZipBatches(
  data: Blob | ArrayBuffer | Uint8Array,
  limits: IngestLimits = DEFAULT_INGEST_LIMITS,
): Promise<IngestResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new ZipRejectedError("invalid_zip", "El archivo no es un ZIP válido.");
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > limits.maxEntries) {
    throw new ZipRejectedError("too_many_entries", "El ZIP contiene demasiadas entradas.");
  }

  // Zip slip: se valida TODO antes de descomprimir nada. JSZip ya resuelve
  // los `..` en `name`, así que se valida el nombre original del archivo.
  const normalized = entries.map((entry) => ({
    entry,
    path: normalizeEntryPath(entry.unsafeOriginalName ?? entry.name),
  }));
  if (normalized.some(({ path }) => path === null)) {
    throw new ZipRejectedError("unsafe_path", "El ZIP contiene rutas absolutas o con «..».");
  }

  const files: IngestFile[] = [];
  let filesSkipped = 0;
  let filesTruncated = 0;
  let decompressed = 0;
  let textBytes = 0;
  let budgetExhausted = false;

  for (const { entry, path: maybePath } of normalized) {
    const path = maybePath ?? "";

    const permissions = entry.unixPermissions;
    const isSymlink =
      typeof permissions === "number" && (permissions & UNIX_FILE_TYPE_MASK) === UNIX_SYMLINK;
    if (isSymlink || isIgnoredPath(path) || hasBinaryExtension(path)) {
      filesSkipped += 1;
      continue;
    }

    if (budgetExhausted || files.length >= limits.maxFiles) {
      filesTruncated += 1;
      continue;
    }

    const sizes = declaredSizes(entry);
    if (sizes) {
      const ratio = sizes.compressed > 0 ? sizes.uncompressed / sizes.compressed : 0;
      if (sizes.uncompressed > limits.maxFileBytes || ratio > limits.maxCompressionRatio) {
        filesTruncated += 1;
        continue;
      }
    }

    const outcome = await readEntryBounded(
      entry,
      limits.maxUncompressedBytes - decompressed,
      limits.maxFileBytes,
    );
    if (outcome.kind === "budget_exceeded") {
      budgetExhausted = true;
      filesTruncated += 1;
      continue;
    }
    if (outcome.kind === "file_too_large") {
      decompressed += limits.maxFileBytes;
      filesTruncated += 1;
      continue;
    }

    decompressed += outcome.bytes.length;
    if (hasNullByte(outcome.bytes)) {
      filesSkipped += 1;
      continue;
    }

    const content = new TextDecoder("utf-8").decode(outcome.bytes);
    const file = { path, content };
    // Ruta y binario ya se revisaron; aquí solo queda el byte nulo en el texto.
    if (getSkipReason(file) === "binary") {
      filesSkipped += 1;
      continue;
    }

    const size = utf8ByteLength(content);
    if (textBytes + size > limits.maxTextBytes) {
      filesTruncated += 1;
      continue;
    }
    textBytes += size;
    files.push(file);
  }

  const { batches, oversized } = buildBatches(files, limits.maxChunkBytes);
  filesTruncated += oversized;

  return {
    batches,
    stats: {
      filesTotal: entries.length,
      filesIncluded: files.length - oversized,
      filesSkipped,
      filesTruncated,
      isFullScan: filesTruncated === 0,
    },
  };
}
