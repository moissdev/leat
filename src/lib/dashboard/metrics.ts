import type { FindingStatus, Severity } from "../i18n/labels";

/**
 * Cálculos del dashboard. Funciones puras: reciben filas ya leídas (con RLS)
 * y no tocan la base. El score por proyecto lo calcula la vista
 * `project_score_v`; aquí solo se agrega (decisiones técnicas, sección 6).
 */

export interface ProjectScoreRow {
  score: number | null;
  active_critical: number | null;
  active_high: number | null;
  active_medium: number | null;
  active_low: number | null;
}

/** Score global = promedio de los scores de los proyectos (null si no hay proyectos). */
export function globalScore(rows: readonly ProjectScoreRow[]): number | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, r) => sum + (r.score ?? 100), 0);
  return Math.round(total / rows.length);
}

export type SeverityTotals = Record<Severity, number>;

/** Hallazgos activos por severidad, sumando todos los proyectos. */
export function severityTotals(rows: readonly ProjectScoreRow[]): SeverityTotals {
  return rows.reduce<SeverityTotals>(
    (acc, r) => ({
      critical: acc.critical + Number(r.active_critical ?? 0),
      high: acc.high + Number(r.active_high ?? 0),
      medium: acc.medium + Number(r.active_medium ?? 0),
      low: acc.low + Number(r.active_low ?? 0),
    }),
    { critical: 0, high: 0, medium: 0, low: 0 },
  );
}

export interface TtrRow {
  resolved_count: number | null;
  avg_ttr_seconds: number | null;
}

/** TTR medio global en segundos, ponderado por hallazgos resueltos (null sin datos). */
export function meanTimeToRemediate(rows: readonly TtrRow[]): number | null {
  let count = 0;
  let weighted = 0;
  for (const r of rows) {
    const n = Number(r.resolved_count ?? 0);
    if (n <= 0 || r.avg_ttr_seconds === null) continue;
    count += n;
    weighted += n * Number(r.avg_ttr_seconds);
  }
  return count === 0 ? null : Math.round(weighted / count);
}

export interface LifecycleRow {
  created_at: string;
  from_status: FindingStatus | null;
  to_status: FindingStatus;
}

export interface TrendPoint {
  /** Día en formato YYYY-MM-DD (zona horaria del dashboard). */
  day: string;
  /** Hallazgos que pasaron a activos: primera detección o reapertura. */
  detected: number;
  /** Hallazgos que pasaron a resueltos (por el usuario o por auto-resolución). */
  resolved: number;
}

/** Día (YYYY-MM-DD) de una fecha en la zona horaria indicada. */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/**
 * Serie diaria de los últimos `days` días (incluido hoy) a partir del log de
 * transiciones. Los días sin movimiento aparecen en cero.
 */
export function trendSeries(
  logs: readonly LifecycleRow[],
  now: Date,
  days: number,
  timeZone: string,
): TrendPoint[] {
  const points = new Map<string, TrendPoint>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = dayKey(new Date(now.getTime() - i * 86_400_000), timeZone);
    points.set(day, { day, detected: 0, resolved: 0 });
  }
  for (const log of logs) {
    const point = points.get(dayKey(new Date(log.created_at), timeZone));
    if (!point) continue;
    if (log.to_status === "active") point.detected += 1;
    else if (log.to_status === "resolved") point.resolved += 1;
  }
  return [...points.values()];
}
