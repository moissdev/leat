import "server-only";
import { Readable } from "node:stream";
import { Octokit } from "@octokit/rest";
import { requireEnv } from "../supabase/env";
import { GithubAccessError, type GithubClient, type GithubRepoMetadata } from "./github";

/**
 * Cliente real de GitHub con el token DE LA APLICACIÓN (solo lectura de
 * repos públicos; `LEAT_GITHUB_TOKEN`). El token nunca sale del servidor ni
 * aparece en errores o logs.
 *
 * El tarball se pide a la API (`/repos/{o}/{r}/tarball/{sha}`), que redirige a
 * `codeload.github.com`; la redirección se sigue a mano y solo hacia ese host
 * (anti SSRF).
 */

const API_BASE = "https://api.github.com";
const TARBALL_HOST = "codeload.github.com";
const USER_AGENT = "leat-scanner";

function statusOf(error: unknown): number | null {
  return typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
    ? error.status
    : null;
}

export class OctokitGithubClient implements GithubClient {
  private readonly octokit: Octokit;

  constructor(private readonly token: string) {
    // Sin el registro interno de octokit: LEAT registra sus propios eventos sin datos sensibles.
    const silent = () => undefined;
    this.octokit = new Octokit({
      auth: token,
      userAgent: USER_AGENT,
      request: { timeout: 15_000 },
      log: { debug: silent, info: silent, warn: silent, error: silent },
    });
  }

  static fromEnv(): OctokitGithubClient {
    return new OctokitGithubClient(requireEnv("LEAT_GITHUB_TOKEN", process.env.LEAT_GITHUB_TOKEN));
  }

  async getRepo(owner: string, repo: string): Promise<GithubRepoMetadata | null> {
    try {
      const { data } = await this.octokit.rest.repos.get({ owner, repo });
      return { defaultBranch: data.default_branch, isPrivate: data.private || data.visibility !== "public" };
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw new GithubAccessError("github_unavailable");
    }
  }

  async getHeadSha(owner: string, repo: string, branch: string): Promise<string> {
    try {
      const { data } = await this.octokit.rest.repos.getBranch({ owner, repo, branch });
      return data.commit.sha;
    } catch {
      throw new GithubAccessError("github_unavailable");
    }
  }

  async openTarball(owner: string, repo: string, sha: string, signal: AbortSignal): Promise<Readable> {
    const apiUrl = `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${encodeURIComponent(sha)}`;
    const first = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "manual",
      signal,
    });

    const location = first.headers.get("location");
    if (first.status < 300 || first.status >= 400 || !location) throw new GithubAccessError("tarball_error");

    let target: URL;
    try {
      target = new URL(location);
    } catch {
      throw new GithubAccessError("tarball_error");
    }
    if (target.protocol !== "https:" || target.hostname !== TARBALL_HOST) {
      throw new GithubAccessError("tarball_error");
    }

    // La URL de codeload ya viene firmada: no se reenvía el token.
    const response = await fetch(target, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "error",
      signal,
    });
    if (!response.ok || !response.body) throw new GithubAccessError("tarball_error");
    return Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>);
  }
}
