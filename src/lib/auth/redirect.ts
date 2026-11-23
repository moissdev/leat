/** Ruta a la que se envía al usuario tras iniciar sesión si no hay `next` válido. */
export const DEFAULT_AFTER_LOGIN = "/dashboard";

const SAFE_BASE = "http://leat.local";

/**
 * Normaliza el parámetro `next` para evitar redirecciones abiertas.
 *
 * Solo acepta rutas relativas del mismo sitio (`/projects?x=1`). Rechaza URLs
 * absolutas, protocol-relative (`//evil.com`), barras invertidas (`/\evil.com`,
 * que algunos navegadores tratan como `//`) y caracteres de control.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_AFTER_LOGIN,
): string {
  if (!raw || raw.length > 512) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;

  try {
    const parsed = new URL(raw, SAFE_BASE);
    if (parsed.origin !== SAFE_BASE) return fallback;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}
