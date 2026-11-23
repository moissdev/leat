import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalScore, severityTotals } from "@/lib/dashboard/metrics";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Enums } from "@/types/database";

/**
 * El dashboard coincide con `project_score_v`: la vista aplica
 * max(0, 100 − (25·críticas + 10·altas + 4·medias + 1·bajas)) sobre hallazgos
 * ACTIVOS, y el score global es el promedio. Usuario temporal en el Supabase
 * de desarrollo; se borra al final.
 */

const admin = createSupabaseAdminClient();
let userId = "";

type Seed = { severity: Enums<"severity_level">; status: Enums<"finding_status"> };

beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `leat-test-${randomUUID()}@example.com`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba (${error?.code ?? "?"})`);
  userId = data.user.id;
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

async function projectWith(name: string, seeds: Seed[]): Promise<string> {
  const project = await admin.from("projects").insert({ user_id: userId, name }).select("id").single();
  if (project.error) throw new Error(project.error.code);
  if (seeds.length > 0) {
    const { error } = await admin.from("findings").insert(
      seeds.map((s, i) => ({
        user_id: userId,
        project_id: project.data.id,
        fingerprint: `${name}-${i}`.padEnd(64, "0"),
        secret_type: "jwt",
        severity: s.severity,
        method: "regex" as const,
        masked_value: "eyJh...abcd",
        status: s.status,
      })),
    );
    if (error) throw new Error(error.code);
  }
  return project.data.id;
}

describe("project_score_v y el dashboard (integración)", () => {
  it("el score por proyecto sigue la fórmula y solo cuenta activos", async () => {
    const a = await projectWith("a", [
      { severity: "critical", status: "active" },
      { severity: "high", status: "active" },
      { severity: "medium", status: "active" },
      { severity: "low", status: "active" },
      { severity: "critical", status: "resolved" }, // no cuenta
      { severity: "critical", status: "ignored" }, // no cuenta
    ]);
    const b = await projectWith("b", Array.from({ length: 5 }, () => ({ severity: "critical", status: "active" }) as Seed));
    const c = await projectWith("c", []);

    const { data } = await admin.from("project_score_v").select("*").eq("user_id", userId);
    const byId = new Map((data ?? []).map((r) => [r.project_id, r]));

    expect(byId.get(a)?.score).toBe(100 - (25 + 10 + 4 + 1)); // 60
    expect(byId.get(b)?.score).toBe(0); // 100 − 125 → acotado a 0
    expect(byId.get(c)?.score).toBe(100);

    const rows = data ?? [];
    expect(globalScore(rows)).toBe(Math.round((60 + 0 + 100) / 3)); // 53
    expect(severityTotals(rows)).toEqual({ critical: 6, high: 1, medium: 1, low: 1 });
  });
});
