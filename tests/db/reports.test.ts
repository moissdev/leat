import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseAlertStore } from "@/lib/alerts/store";
import { alertDeliveryStats, ttrBySeverity } from "@/lib/reports/summaries";
import { createScan } from "@/lib/scans/create";
import { finalizeScan } from "@/lib/scans/finalize";
import { SupabaseScanStore } from "@/lib/scans/persist";
import { processChunk } from "@/lib/scans/process-chunk";
import { getFingerprintPepper, getWebhookEncryptionKey } from "@/lib/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { FAKE } from "../fixtures/secrets";

/**
 * Los informes coinciden con las tablas de log: se genera actividad real
 * (escaneos, auto-resolución y alertas) con un usuario temporal y se compara
 * cada cifra del informe con los registros crudos de los que sale.
 */

const admin = createSupabaseAdminClient();
const store = new SupabaseScanStore(admin);
let userId = "";

beforeAll(async () => {
  const { data, error } = await admin.auth.admin.createUser({
    email: `leat-test-${randomUUID()}@example.com`,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`No se pudo crear el usuario de prueba (${error?.code ?? "?"})`);
  userId = data.user.id;

  const project = await admin.from("projects").insert({ user_id: userId, name: "leat-reports-test" }).select("id").single();
  if (project.error) throw new Error(project.error.code);

  const scanZip = async (content: string) => {
    const created = await createScan(store, userId, { ingest: "zip", project_id: project.data.id, source_name: "r.zip" }, new Date());
    if (!created.ok) throw new Error(created.error);
    await processChunk(store, userId, created.scan.id, { chunk_index: 0, files: [{ path: "a.ts", content }] }, {
      pepper: getFingerprintPepper(),
      now: new Date(),
    });
    await finalizeScan(store, userId, created.scan.id, { files_total: 1, files_skipped: 0, files_truncated: 0 }, new Date());
    return created.scan.id;
  };

  const first = await scanZip(`a="${FAKE.awsAccessKey}"\nb="${FAKE.slackToken}"`);
  await scanZip(`a="${FAKE.awsAccessKey}"`); // auto-resuelve el de Slack (TTR)

  const alerts = new SupabaseAlertStore(admin, getWebhookEncryptionKey);
  await alerts.logAttempt({ userId, scanId: first, severity: "critical", attempt: 1, success: false, httpStatus: 500, error: "http_500" });
  await alerts.logAttempt({ userId, scanId: first, severity: "critical", attempt: 2, success: true, httpStatus: 204, error: null });
});

afterAll(async () => {
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("informes contra las tablas de log (integración)", () => {
  it("scan_report_v coincide con la bitácora de cada escaneo", async () => {
    const scans = await admin.from("scan_report_v").select("*").eq("user_id", userId);
    expect(scans.data).toHaveLength(2);
    for (const scan of scans.data ?? []) {
      const logs = await admin.from("scan_logs").select("event, metadata").eq("scan_id", scan.id ?? "");
      const chunks = (logs.data ?? []).filter((l) => l.event === "chunk_processed");
      const completed = (logs.data ?? []).find((l) => l.event === "scan_completed")?.metadata as Record<string, unknown>;
      const sum = (key: string) => chunks.reduce((n, l) => n + Number((l.metadata as Record<string, unknown>)[key] ?? 0), 0);

      expect(scan.files_scanned).toBe(sum("files_scanned"));
      expect(scan.occurrences_total).toBe(sum("occurrences"));
      expect(scan.findings_new).toBe(completed.findings_new);
      expect(scan.is_full_scan).toBe(completed.is_full_scan);
      expect(scan.duration_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("el TTR por severidad coincide con el log de transiciones", async () => {
    const view = await admin.from("ttr_summary_v").select("severity, resolved_count, avg_ttr_seconds").eq("user_id", userId);
    const raw = await admin
      .from("vulnerability_lifecycle_logs")
      .select("ttr_seconds, findings!inner(severity)")
      .eq("user_id", userId)
      .eq("to_status", "resolved");

    const report = ttrBySeverity(view.data ?? []);
    const high = (raw.data ?? []).filter((r) => r.findings.severity === "high");
    expect(high).toHaveLength(1); // el token de Slack, resuelto automáticamente
    expect(report.find((r) => r.severity === "high")).toEqual({
      severity: "high",
      resolved: 1,
      avgSeconds: Number(high[0]?.ttr_seconds),
    });
    expect(report.find((r) => r.severity === "critical")?.resolved).toBe(0);
  });

  it("las entregas de alertas coinciden con alert_logs", async () => {
    const logs = await admin.from("alert_logs").select("scan_id, attempt, success, created_at").eq("user_id", userId);
    expect(alertDeliveryStats(logs.data ?? [])).toEqual({ deliveries: 1, delivered: 1, failed: 0, attempts: 2 });
  });
});
