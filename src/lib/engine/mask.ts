/**
 * Enmascarado de secretos (decisiones técnicas, sección 2).
 *
 * - 16 caracteres o más: 4 iniciales + "..." + 4 finales (`sk_l...7x9Q`).
 * - Menos de 16: 2 iniciales y el resto `*`.
 * - 4 caracteres o menos: todo `*` (mostrar 2 revelaría la mitad del secreto).
 *
 * Invariante: nunca se revelan más de 8 caracteres del secreto.
 */

export const MASK_SETTINGS = {
  /** A partir de esta longitud se usa el formato `xxxx...yyyy`. */
  longThreshold: 16,
  longVisible: 4,
  shortVisible: 2,
  /** Hasta esta longitud no se revela ningún carácter. */
  fullyHiddenMaxLength: 4,
  ellipsis: "...",
  maskChar: "*",
} as const;

/** Tramo [start, end) de una línea que contiene un secreto. */
export interface SecretSpan {
  start: number;
  end: number;
}

/** Versión enmascarada de un secreto. */
export function maskSecret(secret: string): string {
  // Array.from respeta caracteres fuera del BMP (no parte pares sustitutos).
  const chars = Array.from(secret);
  const { length } = chars;

  if (length >= MASK_SETTINGS.longThreshold) {
    const head = chars.slice(0, MASK_SETTINGS.longVisible).join("");
    const tail = chars.slice(-MASK_SETTINGS.longVisible).join("");
    return `${head}${MASK_SETTINGS.ellipsis}${tail}`;
  }

  const visible = length <= MASK_SETTINGS.fullyHiddenMaxLength ? 0 : MASK_SETTINGS.shortVisible;
  return chars.slice(0, visible).join("") + MASK_SETTINGS.maskChar.repeat(length - visible);
}

/** Ordena y fusiona tramos traslapados o contiguos. */
function mergeSpans(spans: readonly SecretSpan[], lineLength: number): SecretSpan[] {
  const sorted = spans
    .map(({ start, end }) => ({
      start: Math.max(0, Math.min(start, lineLength)),
      end: Math.max(0, Math.min(end, lineLength)),
    }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start);

  const merged: SecretSpan[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Línea con TODOS los secretos indicados sustituidos por su máscara.
 * Debe recibir cada secreto de la línea, no solo el del hallazgo actual.
 */
export function maskLine(text: string, spans: readonly SecretSpan[]): string {
  let result = "";
  let cursor = 0;
  for (const { start, end } of mergeSpans(spans, text.length)) {
    result += text.slice(cursor, start) + maskSecret(text.slice(start, end));
    cursor = end;
  }
  return result + text.slice(cursor);
}
