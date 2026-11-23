import { z } from "zod";
import { SCAN_LIMITS } from "../config";
import { githubRepoUrlSchema } from "../ingest/github-url";

/** Entradas de la API de escaneos (validadas con zod; el `user_id` nunca viene aquí). */

/** Sin caracteres de control (evita inyección en logs y rutas raras). */
const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]+$/;

const projectId = z.uuid("project_id debe ser un UUID.");

/** Nombre del archivo o ZIP: se guarda como `source_ref` (solo el nombre, sin ruta). */
const sourceName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(NO_CONTROL_CHARS, "Nombre de archivo inválido.")
  .transform((name) => name.split(/[\\/]/).pop() ?? name);

export const createScanSchema = z.discriminatedUnion("ingest", [
  z.object({ ingest: z.literal("snippet"), project_id: projectId }),
  z.object({ ingest: z.literal("file"), project_id: projectId, source_name: sourceName }),
  z.object({ ingest: z.literal("zip"), project_id: projectId, source_name: sourceName }),
  z.object({ ingest: z.literal("github"), project_id: projectId, repo_url: githubRepoUrlSchema }),
]);
export type CreateScanInput = z.infer<typeof createScanSchema>;

/** Ruta del archivo dentro del lote: etiqueta para mostrar (≤ 500, límite de la columna). */
const chunkFilePath = z.string().min(1).max(500).regex(NO_CONTROL_CHARS, "Ruta de archivo inválida.");

export const chunkSchema = z.object({
  chunk_index: z.number().int().min(0).max(9_999),
  files: z
    .array(
      z.object({
        path: chunkFilePath,
        // Caracteres, no bytes: el escáner vuelve a medir en bytes UTF-8.
        content: z.string().max(SCAN_LIMITS.maxFileBytes),
      }),
    )
    .min(1)
    .max(SCAN_LIMITS.maxFilesPerScan),
});
export type ChunkInput = z.infer<typeof chunkSchema>;
