/**
 * Contrato público del motor de detección. Módulo puro: sin Next ni Supabase.
 *
 * Regla de privacidad: ninguna estructura que salga del motor contiene el
 * secreto en texto plano. Solo `PatternMatch` (interno) lo lleva, y nunca se
 * expone fuera de `src/lib/engine/`.
 */

export type Severity = "critical" | "high" | "medium" | "low";

export type DetectionMethod = "regex" | "entropy";

/** Hallazgo emitido por el motor; es lo único que sale de él. */
export interface Detection {
  /** Identificador del tipo de secreto, p. ej. "aws_access_key". */
  secretType: string;
  severity: Severity;
  method: DetectionMethod;
  /** HMAC-SHA-256 (hex) del secreto con el pepper del servidor. */
  fingerprint: string;
  maskedValue: string;
  /** Línea (base 1) donde empieza el secreto. */
  line: number;
  /** Línea con TODOS los secretos que contiene ya enmascarados. */
  maskedContext: string;
}

export interface SourceFile {
  path: string;
  content: string;
}

export interface ScanOptions {
  /** Pepper del HMAC; llega como parámetro, el motor no lee variables de entorno. */
  pepper: string;
}

interface PatternBase {
  /** Se persiste como `findings.secret_type`. */
  id: string;
  /** Descripción breve en español (documentación interna). */
  description: string;
  severity: Severity;
}

/**
 * Patrón que se evalúa línea por línea.
 * `regex` debe llevar la bandera `g`, no tener cuantificadores anidados y
 * capturar el secreto en el grupo `secretGroup`.
 */
export interface LinePattern extends PatternBase {
  kind: "line";
  regex: RegExp;
  secretGroup: number;
  /** Filtro adicional sobre el secreto capturado (descarta marcadores, etc.). */
  validate?: (secret: string) => boolean;
}

/**
 * Patrón multilínea delimitado (p. ej. claves PEM). El escáner toma como
 * secreto todo el bloque entre `begin` y `end`, hasta `maxLines` líneas.
 */
export interface BlockPattern extends PatternBase {
  kind: "block";
  begin: RegExp;
  end: RegExp;
  maxLines: number;
}

export type Pattern = LinePattern | BlockPattern;

/**
 * Coincidencia de un patrón de línea. USO INTERNO DEL MOTOR: contiene el
 * secreto en texto plano y nunca debe serializarse ni salir del módulo.
 */
export interface PatternMatch {
  pattern: LinePattern;
  secret: string;
  /** Posición del secreto dentro de la línea: [start, end). */
  start: number;
  end: number;
}
