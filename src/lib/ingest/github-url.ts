import { z } from "zod";

/**
 * Validación estricta de URLs de repositorios públicos de GitHub
 * (decisiones técnicas, sección 9: prevención de SSRF).
 *
 * Solo se acepta `https://github.com/<owner>/<repo>`, con `.git` o `/` final
 * opcionales. Se rechazan otros hosts y esquemas, credenciales, puertos,
 * query, fragmentos, rutas adicionales y segmentos `.` / `..`.
 * Módulo puro: lo usan el cliente y el servidor.
 */

export interface GithubRepoRef {
  owner: string;
  repo: string;
  /** URL canónica: `https://github.com/<owner>/<repo>`. */
  url: string;
}

const MAX_URL_LENGTH = 200;

/** Estructura completa de la URL; los segmentos se validan aparte. */
const URL_SHAPE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/;

/** Usuario u organización: 1–39 caracteres alfanuméricos o `-`, sin `-` al inicio ni al final. */
const OWNER_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

/** Repositorio: 1–100 caracteres alfanuméricos, `.`, `_` o `-`. */
const REPO_REGEX = /^[A-Za-z0-9._-]{1,100}$/;

/** Devuelve la referencia del repositorio o null si la URL no es válida. */
export function parseGithubRepoUrl(input: string): GithubRepoRef | null {
  const value = input.trim();
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return null;

  const shape = URL_SHAPE.exec(value);
  if (!shape) return null;

  const owner = shape[1] ?? "";
  const repo = (shape[2] ?? "").replace(/\.git$/, "");

  if (!OWNER_REGEX.test(owner) || !REPO_REGEX.test(repo)) return null;
  if (repo === "." || repo === ".." || repo.includes("..")) return null;

  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

/** Esquema zod para validar la URL en las entradas de la API. */
export const githubRepoUrlSchema = z.string().transform((value, ctx) => {
  const ref = parseGithubRepoUrl(value);
  if (!ref) {
    ctx.addIssue({
      code: "custom",
      message: "Usa una URL de la forma https://github.com/usuario/repositorio.",
    });
    return z.NEVER;
  }
  return ref;
});
