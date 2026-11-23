import { describe, expect, it } from "vitest";
import { projectFormSchema } from "@/lib/projects/schemas";

describe("projectFormSchema", () => {
  it("acepta un nombre sin repositorio", () => {
    expect(projectFormSchema.parse({ name: "  api-pagos ", repo_url: "" })).toEqual({ name: "api-pagos", github: null });
  });

  it("extrae owner y repo de la URL de GitHub", () => {
    expect(projectFormSchema.parse({ name: "leat", repo_url: "https://github.com/moissdev/leat.git" })).toEqual({
      name: "leat",
      github: { owner: "moissdev", repo: "leat" },
    });
  });

  it.each([
    [{ name: "", repo_url: "" }, "name"],
    [{ name: "x".repeat(81), repo_url: "" }, "name"],
    [{ name: "a\nb", repo_url: "" }, "name"],
    [{ name: "ok", repo_url: "https://gitlab.com/a/b" }, "repo_url"],
    [{ name: "ok", repo_url: "https://github.com/a/b/tree/main" }, "repo_url"],
  ])("rechaza %j en el campo %s", (input, field) => {
    const result = projectFormSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([field]);
  });
});
