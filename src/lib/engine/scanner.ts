import { SCAN_LIMITS } from "../config";
import { findEntropyMatches } from "./entropy";
import { getSkipReason } from "./filters";
import { fingerprintSecret } from "./fingerprint";
import { maskLine, maskSecret, type SecretSpan } from "./mask";
import { matchLinePatterns, PEM_PRIVATE_KEY } from "./patterns";
import type { Detection, DetectionMethod, ScanOptions, Severity, SourceFile } from "./types";

/**
 * Escáner de archivos: combina el catálogo de regex, los bloques PEM y la
 * entropía, y emite `Detection` ya enmascaradas y con huella.
 *
 * El texto plano de los secretos solo existe dentro de esta función; lo que
 * se devuelve no lo contiene.
 */

/** Hallazgo intermedio dentro de una línea (USO INTERNO: lleva el secreto). */
interface RawFinding extends SecretSpan {
  secret: string;
  secretType: string;
  severity: Severity;
  method: DetectionMethod;
}

/** Línea del cuerpo de un PEM: base64, cabeceras `Proc-Type: …` o vacía. */
const PEM_BODY_LINE = /^\s{0,8}(?:[A-Za-z0-9+/=]{0,128}|[A-Za-z-]{1,32}: [^\s].{0,200})\s{0,8}$/;
/** Cualquier bloque PEM (`CERTIFICATE`, `PUBLIC KEY`, …); los no privados no son secretos. */
const ANY_PEM_BEGIN = /-----BEGIN [A-Z0-9 ]{1,60}-----/;
const ANY_PEM_END = /-----END [A-Z0-9 ]{1,60}-----/;
/** Salto de línea escapado dentro de una cadena (`"…\n…"` en JSON o .env). */
const ESCAPED_NEWLINE = /\\r\\n|\\n/g;

/** Normaliza un bloque PEM para que la huella no dependa de CRLF, `\n` escapados o espacios. */
function normalizePem(block: string): string {
  return block
    .replace(ESCAPED_NEWLINE, "\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function overlaps(a: SecretSpan, b: SecretSpan): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Busca un PEM que empieza en `first` (la línea `index`, ya recortada).
 * - En una sola línea (JSON con `\n` escapados): devuelve el tramo exacto.
 * - Multilínea: consume las líneas del cuerpo hasta el `END` (o hasta que deja
 *   de parecer cuerpo) y devuelve cuántas líneas siguientes consumió.
 */
function readPemBlock(
  first: string,
  lines: readonly string[],
  index: number,
): { finding: RawFinding; consumedAfter: number } | null {
  const begin = PEM_PRIVATE_KEY.begin.exec(first);
  if (!begin) return null;

  const base = {
    secretType: PEM_PRIVATE_KEY.id,
    severity: PEM_PRIVATE_KEY.severity,
    method: "regex" as const,
  };

  // Caso 1: BEGIN y END en la misma línea.
  const rest = first.slice(begin.index + begin[0].length);
  const sameLineEnd = PEM_PRIVATE_KEY.end.exec(rest);
  if (sameLineEnd) {
    const start = begin.index;
    const end = begin.index + begin[0].length + sameLineEnd.index + sameLineEnd[0].length;
    const raw = first.slice(start, end);
    return { finding: { ...base, secret: normalizePem(raw), start, end }, consumedAfter: 0 };
  }

  // Caso 2: bloque multilínea.
  const blockLines = [first.slice(begin.index)];
  let consumedAfter = 0;
  const lastIndex = Math.min(lines.length - 1, index + PEM_PRIVATE_KEY.maxLines - 1);
  for (let j = index + 1; j <= lastIndex; j += 1) {
    const current = (lines[j] ?? "").slice(0, SCAN_LIMITS.maxLineLength);
    if (PEM_PRIVATE_KEY.end.test(current)) {
      blockLines.push(current);
      consumedAfter += 1;
      break;
    }
    if (!PEM_BODY_LINE.test(current)) break;
    blockLines.push(current);
    consumedAfter += 1;
  }

  // En la línea del BEGIN solo se enmascara la cabecera en adelante.
  return {
    finding: {
      ...base,
      secret: normalizePem(blockLines.join("\n")),
      start: begin.index,
      end: first.length,
    },
    consumedAfter,
  };
}

/**
 * Si `first` abre un bloque PEM público (certificado, clave pública) en
 * varias líneas, devuelve cuántas líneas siguientes forman su cuerpo, para
 * no analizarlas por entropía. Devuelve 0 en cualquier otro caso.
 */
function publicPemBodyLength(first: string, lines: readonly string[], index: number): number {
  if (!ANY_PEM_BEGIN.test(first) || PEM_PRIVATE_KEY.begin.test(first) || ANY_PEM_END.test(first)) {
    return 0;
  }
  let consumed = 0;
  const lastIndex = Math.min(lines.length - 1, index + PEM_PRIVATE_KEY.maxLines - 1);
  for (let j = index + 1; j <= lastIndex; j += 1) {
    const current = (lines[j] ?? "").slice(0, SCAN_LIMITS.maxLineLength);
    if (ANY_PEM_END.test(current)) return consumed + 1;
    if (!PEM_BODY_LINE.test(current)) return consumed;
    consumed += 1;
  }
  return consumed;
}

/** Hallazgos de regex y entropía en una línea; la regex tiene prioridad. */
function findInLine(text: string, reserved: readonly SecretSpan[]): RawFinding[] {
  const findings: RawFinding[] = [];

  for (const match of matchLinePatterns(text)) {
    if (reserved.some((span) => overlaps(span, match))) continue;
    findings.push({
      secret: match.secret,
      start: match.start,
      end: match.end,
      secretType: match.pattern.id,
      severity: match.pattern.severity,
      method: "regex",
    });
  }

  for (const match of findEntropyMatches(text)) {
    const taken = [...reserved, ...findings];
    if (taken.some((span) => overlaps(span, match))) continue;
    findings.push({
      secret: match.secret,
      start: match.start,
      end: match.end,
      secretType: match.hasContext ? "high_entropy_string_with_context" : "high_entropy_string",
      severity: match.severity,
      method: "entropy",
    });
  }

  return findings;
}

/**
 * Analiza un archivo en memoria y devuelve sus detecciones.
 * Devuelve `[]` para archivos ignorados, binarios o demasiado grandes
 * (el llamador usa `getSkipReason` para contabilizarlos).
 */
export function scanFile(file: SourceFile, options: ScanOptions): Detection[] {
  if (getSkipReason(file) !== null) return [];

  const lines = file.content.split(/\r\n|\r|\n/);
  const detections: Detection[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    // Solo se analiza (y se conserva como contexto) el inicio de líneas muy largas.
    const text = (lines[index] ?? "").slice(0, SCAN_LIMITS.maxLineLength);
    const findings: RawFinding[] = [];

    const pem = readPemBlock(text, lines, index);
    if (pem) findings.push(pem.finding);

    findings.push(...findInLine(text, findings));

    if (findings.length > 0) {
      const maskedContext = maskLine(text, findings);
      for (const finding of findings) {
        detections.push({
          secretType: finding.secretType,
          severity: finding.severity,
          method: finding.method,
          fingerprint: fingerprintSecret(finding.secret, options.pepper),
          maskedValue: maskSecret(finding.secret),
          line: index + 1,
          maskedContext,
        });
      }
    }

    // Las líneas del cuerpo del PEM ya forman parte del hallazgo; las de un
    // PEM público no son secretos.
    index += pem ? pem.consumedAfter : publicPemBodyLength(text, lines, index);
  }

  return detections;
}
