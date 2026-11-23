import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runGithubScan } from "@/lib/ingest/github";
import { OctokitGithubClient } from "@/lib/ingest/github-client";
import { parseGithubRepoUrl } from "@/lib/ingest/github-url";
import { createScan } from "@/lib/scans/create";
import { SupabaseScanStore } from "@/lib/scans/persist";
import { createScanSchema } from "@/lib/scans/schemas";
import { getFingerprintPepper } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Integración real: GitHub (token de la aplicación, repos públicos pequeños)
 * + Supabase de DESARROLLO con un usuario temporal que se borra al final.
 */

const admin = createSupabaseAdminClient();
const store = new SupabaseScanStore(admin);
let userId = "";
let projectId = "";

beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `leat-test-${randomUUID()}@example.com`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba (${error?.code ?? "?"})`);
  userId = data.user.id;
  const project = await admin.from("projects").insert({ user_id: userId, name: "leat-github-test" }).select("id").single();
  if (project.error) throw new Error(project.error.code);
  projectId = project.data.id;
});

// Ningún escaneo de una prueba debe ocupar el cupo de "en curso" de la siguiente.
afterEach(async () => {
  await admin.from("scans").update({ status: "failed" }).eq("user_id", userId).in("status", ["queued", "running"]);
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("escaneo de GitHub (integración real)", () => {
  it.each(["https://github.com/octocat/Hello-World", "https://github.com/octocat/Spoon-Knife"])(
    "analiza %s y guarda el commit SHA",
    async (url) => {
      const ref = parseGithubRepoUrl(url);
      if (!ref) throw new Error("URL inválida");
      const created = await createScan(store, userId, createScanSchema.parse({ ingest: "github", project_id: projectId, repo_url: url }), new Date());
      if (!created.ok) throw new Error(created.error);

      const startedAt = performance.now();
      const outcome = await runGithubScan(
        { store, github: OctokitGithubClient.fromEnv(), pepper: getFingerprintPepper(), clock: () => Date.now() },
        userId,
        created.scan.id,
        ref,
      );
      const ms = Math.round(performance.now() - startedAt);

      expect(outcome.status).toBe("completed");
      const scan = await admin.from("scans").select("*").eq("id", created.scan.id).single();
      expect(scan.data).toMatchObject({ status: "completed", is_full_scan: true });
      expect(scan.data?.source_ref).toMatch(/^[0-9a-f]{40}$/);
      console.info(`${ref.owner}/${ref.repo}: ${scan.data?.files_scanned} archivos, ${scan.data?.bytes_scanned} bytes, ${ms} ms`);
    },
  );

  it("un repo inexistente deja el escaneo en failed con repo_not_found", async () => {
    const url = `https://github.com/octocat/no-existe-${randomUUID().slice(0, 8)}`;
    const ref = parseGithubRepoUrl(url);
    if (!ref) throw new Error("URL inválida");
    const created = await createScan(store, userId, createScanSchema.parse({ ingest: "github", project_id: projectId, repo_url: url }), new Date());
    if (!created.ok) throw new Error(created.error);
    const outcome = await runGithubScan(
      { store, github: OctokitGithubClient.fromEnv(), pepper: getFingerprintPepper(), clock: () => Date.now() },
      userId,
      created.scan.id,
      ref,
    );
    expect(outcome).toEqual({ status: "failed", code: "repo_not_found" });
  });
});
