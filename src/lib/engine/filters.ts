import { SCAN_LIMITS } from "../config";

/**
 * Filtros de archivos (decisiones técnicas, sección 3.4).
 *
 * Módulo puro y sin APIs de Node: también lo usa el navegador
 * (`zip-client.ts`) para descartar archivos antes de enviarlos.
 */

/** Directorios que nunca se analizan (en cualquier nivel de la ruta). */
export const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "vendor",
  "__pycache__",
]);

/** Lockfiles: solo contienen hashes de integridad y URLs de paquetes. */
export const IGNORED_FILE_NAMES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "composer.lock",
  "gemfile.lock",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
]);

/** Sufijos de archivos generados. */
export const IGNORED_SUFFIXES: readonly string[] = [".min.js", ".min.css", ".map"];

/** Extensiones binarias conocidas: imágenes, fuentes, multimedia, archivos y ejecutables. */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  // Imágenes
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "avif", "tif", "tiff", "psd", "heic",
  // Fuentes
  "woff", "woff2", "ttf", "otf", "eot",
  // Audio y video
  "mp3", "mp4", "wav", "ogg", "webm", "mov", "avi", "flac", "m4a",
  // Archivos comprimidos
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "tar", "jar", "war",
  // Ejecutables y binarios compilados
  "exe", "dll", "so", "dylib", "bin", "o", "a", "class", "pyc", "wasm", "node",
  // Documentos binarios
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  // Bases de datos
  "sqlite", "sqlite3", "db",
]);

export type SkipReason = "ignored_path" | "binary" | "too_large";

/** Normaliza separadores y elimina `./` inicial. */
function pathSegments(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter((s) => s.length > 0 && s !== ".");
}

/** ¿La ruta cae en un directorio, lockfile o archivo generado ignorado? */
export function isIgnoredPath(path: string): boolean {
  const segments = pathSegments(path);
  const fileName = (segments.at(-1) ?? "").toLowerCase();
  if (segments.slice(0, -1).some((dir) => IGNORED_DIRECTORIES.has(dir))) return true;
  if (IGNORED_FILE_NAMES.has(fileName)) return true;
  return IGNORED_SUFFIXES.some((suffix) => fileName.endsWith(suffix));
}

/** ¿La extensión corresponde a un formato binario conocido? */
export function hasBinaryExtension(path: string): boolean {
  const fileName = (pathSegments(path).at(-1) ?? "").toLowerCase();
  const dot = fileName.lastIndexOf(".");
  return dot > 0 && BINARY_EXTENSIONS.has(fileName.slice(dot + 1));
}

/** ¿Hay un byte nulo en los primeros bytes? (heurística de binario, como git). */
export function hasNullByte(bytes: Uint8Array, sniffBytes = SCAN_LIMITS.binarySniffBytes): boolean {
  return bytes.subarray(0, sniffBytes).includes(0);
}

/** Igual que `hasNullByte`, sobre texto ya decodificado. */
export function hasNullChar(text: string, sniffChars = SCAN_LIMITS.binarySniffBytes): boolean {
  return text.slice(0, sniffChars).includes("\u0000");
}

/** Longitud en bytes UTF-8 sin depender de `Buffer` ni de `TextEncoder`. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4; // par sustituto: un solo carácter de 4 bytes
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** Motivo por el que un archivo no se analiza, o null si debe analizarse. */
export function getSkipReason(file: { path: string; content: string }): SkipReason | null {
  if (isIgnoredPath(file.path)) return "ignored_path";
  if (hasBinaryExtension(file.path) || hasNullChar(file.content)) return "binary";
  if (utf8ByteLength(file.content) > SCAN_LIMITS.maxFileBytes) return "too_large";
  return null;
}
