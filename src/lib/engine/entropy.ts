import type { Severity } from "./types";

/**
 * Detección por entropía de Shannon (decisiones técnicas, sección 4.2).
 *
 * Captura secretos pseudoaleatorios sin firma conocida. El escáner
 * (checkpoint 8) descarta los candidatos que se traslapan con una coincidencia
 * de regex, que siempre tiene prioridad.
 */

export const ENTROPY_SETTINGS = {
  /** Longitud mínima de un candidato. */
  minLength: 20,
  /** Longitud máxima de un candidato (coincide con la línea máxima analizada). */
  maxLength: 2000,
  /** Umbral en bits por carácter para cadenas hexadecimales. */
  hexThreshold: 3.0,
  /** Umbral en bits por carácter para base64 / alfanuméricas. */
  base64Threshold: 4.2,
} as const;

export type EntropyCharset = "hex" | "base64";

/**
 * Candidato por entropía. USO INTERNO DEL MOTOR: contiene el secreto en
 * texto plano y nunca debe serializarse ni salir del módulo.
 */
export interface EntropyMatch {
  secret: string;
  /** Posición dentro de la línea: [start, end). */
  start: number;
  end: number;
  charset: EntropyCharset;
  entropy: number;
  /** El nombre de la variable sugiere un secreto (`key`, `token`, …). */
  hasContext: boolean;
  severity: Severity;
}

/**
 * Secuencias maximales del alfabeto base64/base64url (incluye hex y
 * alfanumérico). El `=` solo se admite como relleno final, para no unir
 * `NOMBRE=valor` en un único token.
 */
const TOKEN_REGEX = new RegExp(
  `[A-Za-z0-9+/_-]{${ENTROPY_SETTINGS.minLength},${ENTROPY_SETTINGS.maxLength}}={0,2}`,
  "g",
);

const HEX_REGEX = /^[0-9a-f]+$/i;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Integridad de lockfiles / SRI: `sha512-<base64>`. */
const INTEGRITY_REGEX = /^sha(?:1|256|384|512)-/i;
/** Datos incrustados: `data:image/png;base64,<datos>` (el tramo completo de datos). */
const DATA_URI_REGEX = /;base64,[A-Za-z0-9+/=_-]{0,2000}/gi;
/** ETag del paquete `etag` de Node (express, koa…): `<longitud hex>-<SHA-1 base64 de 27>`. */
const ETAG_REGEX = /^[0-9a-f]{1,8}-[A-Za-z0-9+/]{27}$/;
/** Referencia de git fijada (`actions/checkout@<sha>`, `pkg@<sha>`). */
const GIT_SHA_REGEX = /^[0-9a-f]{40}$/i;
/** Tramo de una URL desde el host hasta antes de la query o el fragmento. */
const URL_PATH_REGEX = /[A-Za-z][A-Za-z0-9+.-]{0,20}:\/\/([^\s"'`<>()[\]{}?#]{1,2000})/g;
/** Cabeceras de datos comprimidos codificados en hex: gzip (`1f8b08`) y zlib (`78 01/5e/9c/da`). */
const COMPRESSED_HEX_REGEX = /^(?:1f8b08|78(?:01|5e|9c|da))/i;
/** Proporción de bytes ASCII imprimibles a partir de la cual un hex es texto codificado. */
const PRINTABLE_HEX_RATIO = 0.7;

/**
 * Nombre de variable inmediatamente antes de la asignación del candidato:
 * `apiKey = "…"`, `"token": "…"`, `PASSWORD=…`, `secret => '…'`.
 */
const ASSIGNED_NAME_REGEX = /([A-Za-z_$][A-Za-z0-9_$.-]{0,80})["'`]?\s{0,5}(?::=|=>|==|[:=])\s{0,5}["'`]?$/;

/** Palabras del nombre de variable que suben la severidad (sección 4.1). */
const CONTEXT_REGEX = /key|secret|token|password|pwd|auth/i;

/** Palabras de un nombre que indican un hash o identificador público, no un secreto. */
const NON_SECRET_WORDS = new Set([
  "integrity",
  "checksum",
  "hash",
  "sha",
  "sha1",
  "sha256",
  "sha384",
  "sha512",
  "digest",
  "etag",
  "commit",
  "uuid",
  "guid",
]);

/** Divide un identificador en palabras: `fileSha256`, `FILE_SHA256`, `file-sha` → [file, sha256]. */
export function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function isNonSecretName(name: string): boolean {
  return nameWords(name).some((word) => NON_SECRET_WORDS.has(word));
}

/** Entropía de Shannon en bits por carácter. */
export function shannonEntropy(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);

  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Conjunto de caracteres del candidato, que determina el umbral aplicable. */
export function classifyCharset(value: string): EntropyCharset {
  return HEX_REGEX.test(value) ? "hex" : "base64";
}

/**
 * Exclusiones por forma del candidato (sin mirar el contexto):
 * - UUIDs, integridad de lockfiles (`sha512-…`) y ETags (`8-O2uVAF…`).
 * - Solo dígitos (IDs, timestamps, teléfonos).
 * - Base64 sin dígitos o sin letras: suelen ser palabras, rutas o identificadores.
 */
export function isExcludedShape(value: string): boolean {
  if (UUID_REGEX.test(value) || INTEGRITY_REGEX.test(value) || ETAG_REGEX.test(value)) return true;
  if (/^[0-9]+$/.test(value)) return true;
  if (classifyCharset(value) === "base64") {
    return !/[0-9]/.test(value) || !/[A-Za-z]/.test(value);
  }
  return false;
}

/**
 * ¿Un hex representa datos y no una clave? Texto codificado (la mayoría de
 * sus bytes son ASCII imprimible, improbable en una clave aleatoria, donde
 * ronda el 37 %) o datos comprimidos con cabecera conocida (gzip, zlib).
 */
export function isHexEncodedData(value: string): boolean {
  if (!HEX_REGEX.test(value) || value.length % 2 !== 0) return false;
  if (COMPRESSED_HEX_REGEX.test(value)) return true;
  let printable = 0;
  for (let i = 0; i < value.length; i += 2) {
    const byte = Number.parseInt(value.slice(i, i + 2), 16);
    if (byte >= 0x20 && byte <= 0x7e) printable += 1;
  }
  return printable / (value.length / 2) >= PRINTABLE_HEX_RATIO;
}

/** Tramos [inicio, fin) de host + ruta de las URLs de la línea (sin query ni fragmento). */
function urlPathSpans(text: string): { start: number; end: number }[] {
  return Array.from(text.matchAll(URL_PATH_REGEX), (m) => {
    const start = m.index + m[0].length - (m[1] ?? "").length;
    return { start, end: start + (m[1] ?? "").length };
  });
}

/** Nombre de la variable a la que se asigna el candidato, si lo hay. */
export function assignedName(textBefore: string): string | null {
  return ASSIGNED_NAME_REGEX.exec(textBefore.slice(-100))?.[1] ?? null;
}

/** ¿El candidato supera el umbral de su conjunto de caracteres? */
export function isHighEntropy(value: string): boolean {
  const threshold =
    classifyCharset(value) === "hex"
      ? ENTROPY_SETTINGS.hexThreshold
      : ENTROPY_SETTINGS.base64Threshold;
  return shannonEntropy(value) >= threshold;
}

/**
 * Busca candidatos de alta entropía en una línea.
 * Severidad: Media si el nombre de variable da contexto, Baja si no.
 *
 * USO INTERNO: el resultado contiene secretos en texto plano.
 */
export function findEntropyMatches(text: string): EntropyMatch[] {
  const matches: EntropyMatch[] = [];
  const dataUris = Array.from(text.matchAll(DATA_URI_REGEX), (m) => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
  const urlPaths = urlPathSpans(text);

  const evaluate = (secret: string, start: number): void => {
    if (secret.length < ENTROPY_SETTINGS.minLength) return;
    const before = text.slice(0, start);

    if (dataUris.some((uri) => start >= uri.start && start < uri.end)) return;
    if (isExcludedShape(secret) || !isHighEntropy(secret)) return;
    // Referencias de git fijadas: `uses: actions/checkout@<sha>`.
    if (before.endsWith("@") && GIT_SHA_REGEX.test(secret)) return;

    const name = assignedName(before);
    if (name && isNonSecretName(name)) return;

    const hasContext = name !== null && CONTEXT_REGEX.test(name);
    // Sin contexto, un hex que es texto o datos comprimidos no es una clave.
    if (!hasContext && isHexEncodedData(secret)) return;

    matches.push({
      secret,
      start,
      end: start + secret.length,
      charset: classifyCharset(secret),
      entropy: shannonEntropy(secret),
      hasContext,
      severity: hasContext ? "medium" : "low",
    });
  };

  for (const match of text.matchAll(TOKEN_REGEX)) {
    const token = match[0];
    const start = match.index;
    // En host y ruta de una URL, cada segmento se evalúa por separado:
    // `…/advisories/GHSA-…` no se marca, un token largo en la ruta (webhook) sí.
    if (urlPaths.some((span) => start >= span.start && start < span.end)) {
      let offset = 0;
      for (const segment of token.split("/")) {
        evaluate(segment, start + offset);
        offset += segment.length + 1;
      }
      continue;
    }
    evaluate(token, start);
  }

  return matches;
}
