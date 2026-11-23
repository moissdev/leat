import type { BlockPattern, LinePattern, Pattern, PatternMatch, Severity } from "./types";

/**
 * Catálogo FIJO de patrones (decisiones técnicas, sección 4.1).
 *
 * Reglas para las regex (prevención de ReDoS, sección 4.3):
 * - Sin cuantificadores anidados; repeticiones acotadas con `{m,n}`.
 * - Las líneas llegan ya recortadas a `SCAN_LIMITS.maxLineLength`.
 *
 * El ORDEN importa: si dos patrones coinciden en el mismo tramo de una línea,
 * gana el que aparece primero. Por eso van de mayor a menor severidad y el JWT
 * de `service_role` precede al JWT genérico.
 */

/** Delimitador derecho para tokens con alfabeto base64url (donde `\b` falla con `-`). */
const NOT_B64URL = "(?![A-Za-z0-9_-])";

/** Asignación típica tras un nombre de variable: `= "`, `: '`, `": "`, etc. */
const ASSIGN = `["']?\\s{0,5}[:=]{1,2}>?\\s{0,5}["']?`;

/**
 * Contraseñas de ejemplo de documentación (`postgres://user:pass@…`). Se
 * excluyen pocas a propósito: `admin`, `root` o `test` en una configuración
 * real SÍ son una filtración.
 */
const PLACEHOLDER_PASSWORDS = new Set(["pass", "password", "passwd", "pwd", "changeme", "example"]);

/** Rechaza contraseñas que en realidad son marcadores de plantilla o de documentación. */
function isRealPassword(secret: string): boolean {
  if (/^(?:\$\{|\$[A-Z_]|\{\{|<|%\(|%s$)/.test(secret)) return false;
  const lower = secret.toLowerCase();
  if (PLACEHOLDER_PASSWORDS.has(lower) || /^your[_-]?(?:db[_-]?)?(?:pass|password|pwd)$/.test(lower)) return false;
  // Rellenos: `xxxx`, `****`, `....`, `…`.
  return !/^(?:x+|\*+|\.+|…+)$/i.test(secret);
}

/** Decodifica un segmento base64url de JWT a objeto JSON, o null si no lo es. */
function decodeJwtSegment(segment: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** JWT estructuralmente válido: cabecera JSON con `alg` y payload JSON. */
function isJwt(token: string): boolean {
  const [header, payload] = token.split(".");
  if (!header || !payload) return false;
  const decodedHeader = decodeJwtSegment(header);
  return typeof decodedHeader?.alg === "string" && decodeJwtSegment(payload) !== null;
}

function isSupabaseServiceRoleJwt(token: string): boolean {
  if (!isJwt(token)) return false;
  const payload = decodeJwtSegment(token.split(".")[1] ?? "");
  return payload?.role === "service_role";
}

const JWT_REGEX_SOURCE = `\\b(eyJ[A-Za-z0-9_-]{8,2000}\\.eyJ[A-Za-z0-9_-]{8,2000}\\.[A-Za-z0-9_-]{8,2000})${NOT_B64URL}`;

function line(
  id: string,
  description: string,
  severity: Severity,
  source: string,
  options: { flags?: string; secretGroup?: number; validate?: (secret: string) => boolean } = {},
): LinePattern {
  return {
    kind: "line",
    id,
    description,
    severity,
    // `d` (hasIndices) da la posición exacta del grupo capturado.
    regex: new RegExp(source, `gd${options.flags ?? ""}`),
    secretGroup: options.secretGroup ?? 1,
    validate: options.validate,
  };
}

const PRIVATE_KEY_KINDS = "(?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?";

export const PEM_PRIVATE_KEY: BlockPattern = {
  kind: "block",
  id: "private_key_pem",
  description: "Clave privada en formato PEM",
  severity: "critical",
  begin: new RegExp(`-----BEGIN ${PRIVATE_KEY_KINDS}PRIVATE KEY(?: BLOCK)?-----`),
  end: new RegExp(`-----END ${PRIVATE_KEY_KINDS}PRIVATE KEY(?: BLOCK)?-----`),
  // Una RSA de 4096 bits ocupa ~52 líneas de 64 caracteres; margen amplio.
  maxLines: 200,
};

export const LINE_PATTERNS: readonly LinePattern[] = [
  // ── Crítica ────────────────────────────────────────────────────────────────
  line(
    "aws_access_key",
    "AWS Access Key ID",
    "critical",
    "\\b((?:AKIA|ASIA)[A-Z0-9]{16})\\b",
  ),
  line(
    "aws_secret_key",
    "AWS Secret Access Key (con contexto)",
    "critical",
    `\\baws_?secret_?(?:access_?)?key${ASSIGN}([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+=])`,
    { flags: "i" },
  ),
  line(
    "stripe_live_key",
    "Stripe live (secreta o restringida)",
    "critical",
    "\\b((?:sk|rk)_live_[A-Za-z0-9]{24,247})\\b",
  ),
  line(
    "connection_string",
    "Connection string con credenciales",
    "critical",
    "\\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\\+srv)?|rediss?|amqps?|mssql|sqlserver)://[^\\s:/@'\"`]{1,128}:([^\\s@'\"`]{1,256})@[^\\s'\"`]{1,512}",
    { validate: isRealPassword },
  ),
  line(
    "supabase_service_role_jwt",
    "JWT de Supabase con rol service_role",
    "critical",
    JWT_REGEX_SOURCE,
    { validate: isSupabaseServiceRoleJwt },
  ),
  // ── Alta ───────────────────────────────────────────────────────────────────
  line(
    "github_token",
    "Token de GitHub (clásico, OAuth, app o refresh)",
    "high",
    "\\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36})\\b",
  ),
  line(
    "github_fine_grained_token",
    "Token de GitHub de grano fino",
    "high",
    "\\b(github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59})\\b",
  ),
  line(
    "slack_token",
    "Token de Slack",
    "high",
    "\\b(xox[baprs]-[0-9]{8,13}-[A-Za-z0-9-]{8,200})\\b",
  ),
  line("google_api_key", "Google API key", "high", `\\b(AIza[0-9A-Za-z_-]{35})${NOT_B64URL}`),
  line(
    "sendgrid_api_key",
    "SendGrid API key",
    "high",
    `\\b(SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43})${NOT_B64URL}`,
  ),
  line("twilio_api_key", "Twilio API key (SID SK…)", "high", "\\b(SK[0-9a-f]{32})\\b"),
  line(
    "twilio_auth_token",
    "Twilio Auth Token (con contexto)",
    "high",
    `\\btwilio_?auth_?token${ASSIGN}([0-9a-f]{32})\\b`,
    { flags: "i" },
  ),
  // ── Media ──────────────────────────────────────────────────────────────────
  line("stripe_test_key", "Stripe test (secreta)", "medium", "\\b(sk_test_[A-Za-z0-9]{24,247})\\b"),
  line("jwt", "JSON Web Token", "medium", JWT_REGEX_SOURCE, { validate: isJwt }),
];

/** Catálogo completo (línea + bloque), útil para documentación y pruebas. */
export const PATTERNS: readonly Pattern[] = [PEM_PRIVATE_KEY, ...LINE_PATTERNS];

/**
 * Aplica los patrones de línea a una línea y resuelve solapes: si dos
 * coincidencias se traslapan, se conserva la del patrón más prioritario.
 * Devuelve las coincidencias ordenadas por posición.
 *
 * USO INTERNO: el resultado contiene secretos en texto plano.
 */
export function matchLinePatterns(text: string): PatternMatch[] {
  const accepted: PatternMatch[] = [];

  for (const pattern of LINE_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const secret = match[pattern.secretGroup];
      const span = match.indices?.[pattern.secretGroup];
      if (!secret || !span) continue;
      if (pattern.validate && !pattern.validate(secret)) continue;

      const [start, end] = span;
      const overlaps = accepted.some((m) => start < m.end && m.start < end);
      if (!overlaps) accepted.push({ pattern, secret, start, end });
    }
  }

  return accepted.sort((a, b) => a.start - b.start);
}
