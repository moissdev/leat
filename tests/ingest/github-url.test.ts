import { describe, expect, it } from "vitest";
import { githubRepoUrlSchema, parseGithubRepoUrl } from "@/lib/ingest/github-url";

describe("parseGithubRepoUrl: acepta", () => {
  it.each([
    ["https://github.com/vercel/next.js", "vercel", "next.js"],
    ["https://github.com/moissdev/leat", "moissdev", "leat"],
    ["https://github.com/moissdev/leat/", "moissdev", "leat"],
    ["https://github.com/moissdev/leat.git", "moissdev", "leat"],
    ["  https://github.com/a/b  ", "a", "b"],
    ["https://github.com/my-org/repo_name-2", "my-org", "repo_name-2"],
  ])("%s", (input, owner, repo) => {
    expect(parseGithubRepoUrl(input)).toEqual({
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`,
    });
  });
});

describe("parseGithubRepoUrl: rechaza", () => {
  it.each([
    ["esquema http", "http://github.com/a/b"],
    ["esquema git", "git://github.com/a/b"],
    ["esquema ssh", "git@github.com:a/b.git"],
    ["esquema file", "file:///etc/passwd"],
    ["sin esquema", "github.com/a/b"],
    ["otro host", "https://gitlab.com/a/b"],
    ["subdominio", "https://api.github.com/a/b"],
    ["host parecido", "https://github.com.evil.example/a/b"],
    ["host con mayúsculas", "https://GitHub.com/a/b"],
    ["credenciales", "https://user:pass@github.com/a/b"],
    ["usuario en el host", "https://github.com@evil.example/a/b"],
    ["puerto", "https://github.com:443/a/b"],
    ["ruta adicional", "https://github.com/a/b/tree/main"],
    ["solo owner", "https://github.com/a"],
    ["query", "https://github.com/a/b?tab=readme"],
    ["fragmento", "https://github.com/a/b#readme"],
    ["repo ..", "https://github.com/a/.."],
    ["repo .", "https://github.com/a/."],
    ["owner ..", "https://github.com/../b"],
    ["repo con ..", "https://github.com/a/b..c"],
    ["codificación %2e", "https://github.com/a/%2e%2e"],
    ["barra invertida", "https://github.com/a\\b/c"],
    ["owner con guion inicial", "https://github.com/-a/b"],
    ["owner demasiado largo", `https://github.com/${"a".repeat(40)}/b`],
    ["espacios internos", "https://github.com/a b/c"],
    ["salto de línea", "https://github.com/a/b\nhttps://evil.example"],
    ["vacío", ""],
    ["demasiado larga", `https://github.com/a/${"b".repeat(200)}`],
  ])("%s", (_label, input) => {
    expect(parseGithubRepoUrl(input)).toBeNull();
  });
});

describe("githubRepoUrlSchema", () => {
  it("transforma una URL válida en su referencia", () => {
    expect(githubRepoUrlSchema.parse("https://github.com/a/b.git")).toEqual({
      owner: "a",
      repo: "b",
      url: "https://github.com/a/b",
    });
  });

  it("devuelve un error en español para URLs inválidas", () => {
    const result = githubRepoUrlSchema.safeParse("https://evil.example/a/b");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("https://github.com/");
  });
});
