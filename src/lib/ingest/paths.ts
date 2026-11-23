import { ZIP_LIMITS } from "../config";

/**
 * Normaliza la ruta de una entrada de archivo comprimido (ZIP o tarball) o
 * devuelve null si es insegura: absoluta (`/x`, `C:\x`, `\\servidor`), con
 * `..`, byte nulo o demasiado larga. Módulo puro (cliente y servidor).
 */
export function normalizeEntryPath(raw: string): string | null {
  if (raw.length === 0 || raw.length > ZIP_LIMITS.maxPathLength || raw.includes("\u0000")) return null;
  const path = raw.replace(/\\/g, "/");
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return null;

  const segments = path.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.length === 0 || segments.some((s) => s === "..")) return null;
  return segments.join("/");
}
