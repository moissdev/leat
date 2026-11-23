import { RATE_LIMITS } from "../config";
import type { ScanStore } from "./persist";

/**
 * Rate limit por usuario contado sobre la tabla `scans` (sin infraestructura
 * extra): ≤ 10 escaneos por hora y ≤ 2 en curso (`queued` o `running`).
 */

export type RateLimitResult = { ok: true } | { ok: false; reason: "hourly_limit" | "concurrent_limit" };

const HOUR_MS = 60 * 60 * 1000;

export async function checkScanRateLimit(
  store: ScanStore,
  userId: string,
  now: Date,
): Promise<RateLimitResult> {
  const [lastHour, active] = await Promise.all([
    store.countScansCreatedSince(userId, new Date(now.getTime() - HOUR_MS)),
    store.countActiveScans(userId),
  ]);
  if (lastHour >= RATE_LIMITS.maxScansPerHour) return { ok: false, reason: "hourly_limit" };
  if (active >= RATE_LIMITS.maxConcurrentScans) return { ok: false, reason: "concurrent_limit" };
  return { ok: true };
}
