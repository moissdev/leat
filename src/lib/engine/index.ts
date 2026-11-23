/**
 * API pública del motor de detección. Fuera de `src/lib/engine/` solo se
 * importa desde aquí: lo que no se exporta (coincidencias con texto plano)
 * no puede salir del módulo.
 *
 * Excepción: el código de navegador importa `engine/filters` directamente,
 * porque este índice arrastra `node:crypto` (huella HMAC).
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
