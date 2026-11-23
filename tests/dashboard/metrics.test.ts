import { describe, expect, it } from "vitest";
import {
  dayKey,
  globalScore,
  meanTimeToRemediate,
  severityTotals,
  trendSeries,
  type LifecycleRow,
  type ProjectScoreRow,
} from "@/lib/dashboard/metrics";

const row = (score: number, c = 0, h = 0, m = 0, l = 0): ProjectScoreRow => ({
  score,
  active_critical: c,
  active_high: h,
  active_medium: m,
  active_low: l,
});

describe("globalScore", () => {
  it("es el promedio redondeado de los scores de los proyectos", () => {
    expect(globalScore([row(100), row(65), row(40)])).toBe(68);
  });

  it("null sin proyectos", () => {
    expect(globalScore([])).toBeNull();
  });
});

describe("severityTotals", () => {
  it("suma los activos por severidad de todos los proyectos", () => {
    expect(severityTotals([row(0, 1, 2, 3, 4), row(0, 1, 0, 0, 1)])).toEqual({ critical: 2, high: 2, medium: 3, low: 5 });
  });
});

describe("meanTimeToRemediate", () => {
  it("pondera por número de resueltos e ignora filas vacías", () => {
    expect(
      meanTimeToRemediate([
        { resolved_count: 1, avg_ttr_seconds: 100 },
        { resolved_count: 3, avg_ttr_seconds: 300 },
        { resolved_count: 0, avg_ttr_seconds: 9999 },
        { resolved_count: 2, avg_ttr_seconds: null },
      ]),
    ).toBe(250);
  });

  it("null sin hallazgos resueltos", () => {
    expect(meanTimeToRemediate([])).toBeNull();
  });
});

describe("trendSeries", () => {
  const TZ = "America/Mexico_City";
  const now = new Date("2026-11-22T18:00:00Z"); // 12:00 en CDMX

  it("devuelve un punto por día, incluidos los días sin movimiento", () => {
    const series = trendSeries([], now, 7, TZ);
    expect(series).toHaveLength(7);
    expect(series.at(-1)).toEqual({ day: "2026-11-22", detected: 0, resolved: 0 });
    expect(series[0]?.day).toBe("2026-11-16");
  });

  it("cuenta detecciones (primera o reapertura) y resoluciones por día local", () => {
    const logs: LifecycleRow[] = [
      { created_at: "2026-11-22T17:00:00Z", from_status: null, to_status: "active" },
      { created_at: "2026-11-22T17:30:00Z", from_status: "resolved", to_status: "active" },
      { created_at: "2026-11-22T15:00:00Z", from_status: "active", to_status: "resolved" },
      // 03:00 UTC del 22 = 21:00 del 21 en CDMX: cuenta para el día 21.
      { created_at: "2026-11-22T03:00:00Z", from_status: "active", to_status: "resolved" },
      { created_at: "2026-11-22T12:00:00Z", from_status: "active", to_status: "ignored" },
      // Fuera de la ventana: se ignora.
      { created_at: "2026-10-01T12:00:00Z", from_status: null, to_status: "active" },
    ];
    const series = trendSeries(logs, now, 7, TZ);
    expect(series.at(-1)).toEqual({ day: "2026-11-22", detected: 2, resolved: 1 });
    expect(series.at(-2)).toEqual({ day: "2026-11-21", detected: 0, resolved: 1 });
    expect(series.reduce((n, p) => n + p.detected + p.resolved, 0)).toBe(4);
  });

  it("dayKey usa la zona horaria indicada", () => {
    expect(dayKey(new Date("2026-11-22T03:00:00Z"), TZ)).toBe("2026-11-21");
    expect(dayKey(new Date("2026-11-22T03:00:00Z"), "UTC")).toBe("2026-11-22");
  });
});
