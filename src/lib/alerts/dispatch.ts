import { ALERT_LIMITS } from "../config";
import { buildAlertPayload, type AlertFinding, type AlertSeverity } from "./discord";

/**
 * Envío de alertas a Discord: best-effort, timeout corto y hasta 3
 * reintentos con backoff exponencial. Cada intento queda en `alert_logs`.
 * Nunca lanza: un fallo de alertas no debe afectar el cierre del escaneo.
 *
 * La URL del webhook nunca se registra ni aparece en errores.
 */

export interface AlertStore {
  /** Webhook descifrado si está configurado y las alertas están activas; null si no. */
  getActiveWebhookUrl(userId: string): Promise<string | null>;
  getProjectName(userId: string, projectId: string): Promise<string>;
  /** Hallazgos Alta/Crítica `active` entre los indicados, con su primera ubicación en el escaneo. */
  getAlertableFindings(
    userId: string,
    scanId: string,
    findingIds: readonly string[],
  ): Promise<(Omit<AlertFinding, "reopened"> & { id: string })[]>;
  logAttempt(entry: AlertAttemptLog): Promise<void>;
}

export interface AlertAttemptLog {
  userId: string;
  scanId: string | null;
  severity: AlertSeverity;
  attempt: number;
  success: boolean;
  httpStatus: number | null;
  /** Código corto (`timeout`, `network_error`, `http_500`…), nunca la URL ni el cuerpo. */
  error: string | null;
}

export interface DispatchDeps {
  store: AlertStore;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
}

export interface ScanAlertRequest {
  userId: string;
  scanId: string;
  projectId: string;
  newFindingIds: readonly string[];
  reopenedFindingIds: readonly string[];
  scanUrl: string | null;
}

export type DispatchOutcome =
  | { status: "sent"; attempts: number; findings: number }
  | { status: "failed"; attempts: number; findings: number }
  | { status: "skipped"; reason: "no_alertable_findings" | "webhook_not_configured" | "error" };

export const MAX_ATTEMPTS = 1 + ALERT_LIMITS.maxRetries;
/** Tope de espera cuando Discord responde 429 con `retry_after`. */
const MAX_RETRY_AFTER_MS = 10_000;

export interface SendResult {
  success: boolean;
  httpStatus: number | null;
  error: string | null;
  retryable: boolean;
  retryAfterMs: number | null;
}

/** Un intento HTTP con timeout. No lanza. */
export async function postWebhook(
  fetchFn: typeof fetch,
  url: string,
  payload: unknown,
  timeoutMs: number = ALERT_LIMITS.requestTimeoutMs,
): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "error",
    });
    if (response.ok) {
      return { success: true, httpStatus: response.status, error: null, retryable: false, retryAfterMs: null };
    }
    let retryAfterMs: number | null = null;
    if (response.status === 429) {
      const body: unknown = await response.json().catch(() => null);
      const seconds =
        body !== null && typeof body === "object" && "retry_after" in body ? Number(body.retry_after) : NaN;
      retryAfterMs = Number.isFinite(seconds) ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : null;
    }
    return {
      success: false,
      httpStatus: response.status,
      error: `http_${response.status}`,
      retryable: response.status === 429 || response.status >= 500,
      retryAfterMs,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      success: false,
      httpStatus: null,
      error: timedOut ? "timeout" : "network_error",
      retryable: true,
      retryAfterMs: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Envía las alertas de un escaneo. Nunca lanza. */
export async function dispatchScanAlerts(deps: DispatchDeps, request: ScanAlertRequest): Promise<DispatchOutcome> {
  try {
    const candidateIds = [...new Set([...request.newFindingIds, ...request.reopenedFindingIds])];
    if (candidateIds.length === 0) return { status: "skipped", reason: "no_alertable_findings" };

    const findings = await deps.store.getAlertableFindings(request.userId, request.scanId, candidateIds);
    if (findings.length === 0) return { status: "skipped", reason: "no_alertable_findings" };

    const url = await deps.store.getActiveWebhookUrl(request.userId);
    if (!url) return { status: "skipped", reason: "webhook_not_configured" };

    const reopened = new Set(request.reopenedFindingIds);
    const alertFindings: AlertFinding[] = findings.map(({ id, ...f }) => ({ ...f, reopened: reopened.has(id) }));
    const severity: AlertSeverity = alertFindings.some((f) => f.severity === "critical") ? "critical" : "high";
    const payload = buildAlertPayload({
      projectName: await deps.store.getProjectName(request.userId, request.projectId),
      scanId: request.scanId,
      scanUrl: request.scanUrl,
      findings: alertFindings,
      timestamp: deps.now(),
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const result = await postWebhook(deps.fetch, url, payload);
      await deps.store.logAttempt({
        userId: request.userId,
        scanId: request.scanId,
        severity,
        attempt,
        success: result.success,
        httpStatus: result.httpStatus,
        error: result.error,
      });
      if (result.success) return { status: "sent", attempts: attempt, findings: alertFindings.length };
      if (!result.retryable || attempt === MAX_ATTEMPTS) {
        return { status: "failed", attempts: attempt, findings: alertFindings.length };
      }
      await deps.sleep(result.retryAfterMs ?? ALERT_LIMITS.backoffBaseMs * 2 ** (attempt - 1));
    }
    return { status: "failed", attempts: MAX_ATTEMPTS, findings: alertFindings.length };
  } catch (error) {
    console.error("[alerts] error interno", { name: error instanceof Error ? error.name : typeof error });
    return { status: "skipped", reason: "error" };
  }
}
