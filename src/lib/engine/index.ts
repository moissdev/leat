/**
 * API pública del motor de detección. Fuera de `src/lib/engine/` solo se
 * importa desde aquí: lo que no se exporta (coincidencias con texto plano)
 * no puede salir del módulo.
 */
export { scanFile } from "./scanner";
export {
  getSkipReason,
  hasBinaryExtension,
  hasNullByte,
  isIgnoredPath,
  utf8ByteLength,
  type SkipReason,
} from "./filters";
export { MIN_PEPPER_LENGTH } from "./fingerprint";
export type { Detection, DetectionMethod, ScanOptions, Severity, SourceFile } from "./types";
