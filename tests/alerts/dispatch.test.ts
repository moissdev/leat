import { describe, expect, it } from "vitest";
import {
  dispatchScanAlerts,
  MAX_ATTEMPTS,
  type AlertAttemptLog,
  type AlertStore,
  type DispatchDeps,
} from "@/lib/alerts/dispatch";
import { ALERT_LIMITS } from "@/lib/config";
import { maskSecret } from "@/lib/engine/mask";
import { alnum, FAKE } from "../fixtures/secrets";

const USER = "user-1";
const SCAN = "scan-1";
const WEBHOOK = "https://discord.com/api/webhooks/" + "123456789012345678" + "/" + alnum(68, 4);

type StoredFinding = Awaited<ReturnType<AlertStore["getAlertableFindings"]>>[number] & { status: string };

/** Store en memoria: filtra como la consulta real (activos, Alta/Crítica, del usuario). */
class FakeAlertStore implements AlertStore {
  attempts: AlertAttemptLog[] = [];
  webhook: string | null = WEBHOOK;
  findings: StoredFinding[] = [
    { id: "f-crit", severity: "critical", secretType: "aws_access_key", maskedValue: maskSecret(FAKE.awsAccessKey), filePath: "a.ts", lineNumber: 1, status: "active" },
    { id: "f-high", severity: "high", secretType: "github_token", maskedValue: maskSecret(FAKE.githubToken), filePath: "b.ts", lineNumber: 2, status: "active" },
  ];
  async getActiveWebhookUrl() {
    return this.webhook;
  }
  async getProjectName() {
    return "Proyecto";
  }
  async getAlertableFindings(_userId: string, _scanId: string, ids: readonly string[]) {
    return this.findings
      .filter((f) => ids.includes(f.id) && f.status === "active")
      .map((f) => ({
        id: f.id,
        severity: f.severity,
        secretType: f.secretType,
        maskedValue: f.maskedValue,
        filePath: f.filePath,
        lineNumber: f.lineNumber,
      }));
  }
  async logAttempt(entry: AlertAttemptLog) {
    this.attempts.push(entry);
  }
}

function setup(responses: (Response | Error)[]) {
  const store = new FakeAlertStore();
  const calls: { url: string; body: string }[] = [];
  const sleeps: number[] = [];
  const queue = [...responses];
  const deps: DispatchDeps = {
    store,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body) });
      const next = queue.shift() ?? new Response(null, { status: 204 });
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => new Date(0),
  };
  return { store, calls, sleeps, deps };
}

const request = (overrides: Partial<Parameters<typeof dispatchScanAlerts>[1]> = {}) => ({
  userId: USER,
  scanId: SCAN,
  projectId: "p-1",
  newFindingIds: ["f-crit"],
  reopenedFindingIds: ["f-high"],
  scanUrl: null,
  ...overrides,
});

describe("dispatchScanAlerts", () => {
  it("envía UN mensaje con los nuevos y reabiertos Alta/Crítica y registra el intento", async () => {
    const { store, calls, deps } = setup([new Response(null, { status: 204 })]);
    const outcome = await dispatchScanAlerts(deps, request());
    expect(outcome).toEqual({ status: "sent", attempts: 1, findings: 2 });
    expect(calls).toHaveLength(1);
    expect(store.attempts).toEqual([
      { userId: USER, scanId: SCAN, severity: "critical", attempt: 1, success: true, httpStatus: 204, error: null },
    ]);
  });

  it("el payload solo lleva datos enmascarados", async () => {
    const { calls, deps } = setup([]);
    await dispatchScanAlerts(deps, request());
    expect(calls[0]?.body).not.toContain(FAKE.awsAccessKey);
    expect(calls[0]?.body).not.toContain(FAKE.githubToken);
  });

  it("no envía si no hay hallazgos nuevos o reabiertos", async () => {
    const { calls, store, deps } = setup([]);
    expect(await dispatchScanAlerts(deps, request({ newFindingIds: [], reopenedFindingIds: [] }))).toEqual({
      status: "skipped",
      reason: "no_alertable_findings",
    });
    expect(calls).toHaveLength(0);
    expect(store.attempts).toHaveLength(0);
  });

  it("no envía hallazgos Media/Baja ni los que ya no están activos", async () => {
    const { calls, store, deps } = setup([]);
    store.findings.push({ id: "f-low", severity: "high", secretType: "x", maskedValue: "****", filePath: null, lineNumber: null, status: "ignored" });
    // La consulta real ya filtra Media/Baja; aquí solo quedan inactivos o inexistentes.
    expect((await dispatchScanAlerts(deps, request({ newFindingIds: ["f-low", "f-medium"], reopenedFindingIds: [] }))).status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("no envía si el webhook no está configurado o las alertas están desactivadas", async () => {
    const { calls, deps, store } = setup([]);
    store.webhook = null;
    expect(await dispatchScanAlerts(deps, request())).toEqual({ status: "skipped", reason: "webhook_not_configured" });
    expect(calls).toHaveLength(0);
  });

  it(`reintenta errores transitorios hasta ${ALERT_LIMITS.maxRetries} veces con backoff y registra cada intento`, async () => {
    const { store, sleeps, deps } = setup([
      new Response(null, { status: 500 }),
      new Error("fetch failed"),
      new Response(null, { status: 503 }),
      new Response(null, { status: 502 }),
    ]);
    const outcome = await dispatchScanAlerts(deps, request());
    expect(outcome).toEqual({ status: "failed", attempts: MAX_ATTEMPTS, findings: 2 });
    expect(MAX_ATTEMPTS).toBe(1 + ALERT_LIMITS.maxRetries);
    expect(store.attempts.map((a) => [a.attempt, a.success, a.httpStatus, a.error])).toEqual([
      [1, false, 500, "http_500"],
      [2, false, null, "network_error"],
      [3, false, 503, "http_503"],
      [4, false, 502, "http_502"],
    ]);
    const base = ALERT_LIMITS.backoffBaseMs;
    expect(sleeps).toEqual([base, base * 2, base * 4]);
  });

  it("se recupera si un reintento tiene éxito", async () => {
    const { store, deps } = setup([new Response(null, { status: 500 }), new Response(null, { status: 204 })]);
    expect(await dispatchScanAlerts(deps, request())).toEqual({ status: "sent", attempts: 2, findings: 2 });
    expect(store.attempts.map((a) => a.success)).toEqual([false, true]);
  });

  it("no reintenta errores definitivos (4xx)", async () => {
    const { store, deps } = setup([new Response(null, { status: 404 })]);
    expect(await dispatchScanAlerts(deps, request())).toEqual({ status: "failed", attempts: 1, findings: 2 });
    expect(store.attempts).toHaveLength(1);
  });

  it("respeta retry_after en 429 (acotado)", async () => {
    const { sleeps, deps } = setup([
      new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429 }),
      new Response(null, { status: 204 }),
    ]);
    expect((await dispatchScanAlerts(deps, request())).status).toBe("sent");
    expect(sleeps).toEqual([1500]);
  });

  it("los registros de intento nunca contienen la URL del webhook", async () => {
    const { store, deps } = setup([new Error(`connect ECONNREFUSED ${WEBHOOK}`)]);
    await dispatchScanAlerts(deps, request());
    expect(JSON.stringify(store.attempts)).not.toContain(WEBHOOK);
    expect(JSON.stringify(store.attempts)).not.toContain("discord.com");
  });

  it("nunca lanza aunque falle la base de datos", async () => {
    const { deps, store } = setup([]);
    store.getAlertableFindings = async () => {
      throw new Error("db down");
    };
    expect(await dispatchScanAlerts(deps, request())).toEqual({ status: "skipped", reason: "error" });
  });
});
