import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";
import {
  globalScore,
  meanTimeToRemediate,
  severityTotals,
  trendSeries,
  type LifecycleRow,
  type SeverityTotals,
  type TrendPoint,
} from "./metrics";

/** Datos del dashboard, leídos con la sesión del usuario (RLS). */

export const DASHBOARD_TIME_ZONE = "America/Mexico_City";
export const TREND_DAYS = 30;
const PAGE_SIZE = 1000;

export interface DashboardData {
  projectCount: number;
  globalScore: number | null;
  totals: SeverityTotals;
  scansLast30Days: number;
  meanTtrSeconds: number | null;
  trend: TrendPoint[];
  atRisk: Tables<"project_score_v">[];
  recentScans: Tables<"scan_report_v">[];
}

export async function getDashboardData(now: Date): Promise<DashboardData> {
  const supabase = await createSupabaseServerClient();
  const since = new Date(now.getTime() - TREND_DAYS * 86_400_000).toISOString();

  const [scores, ttr, scansCount, recent] = await Promise.all([
    supabase.from("project_score_v").select("*"),
    supabase.from("ttr_summary_v").select("resolved_count, avg_ttr_seconds"),
    supabase.from("scans").select("id", { count: "exact", head: true }).gte("created_at", since),
    supabase.from("scan_report_v").select("*").order("created_at", { ascending: false }).limit(5),
  ]);

  // El log de transiciones puede superar el máximo de filas por respuesta: se pagina.
  const logs: LifecycleRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data } = await supabase
      .from("vulnerability_lifecycle_logs")
      .select("created_at, from_status, to_status")
      .gte("created_at", since)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    logs.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
  }

  const scoreRows = scores.data ?? [];
  return {
    projectCount: scoreRows.length,
    globalScore: globalScore(scoreRows),
    totals: severityTotals(scoreRows),
    scansLast30Days: scansCount.count ?? 0,
    meanTtrSeconds: meanTimeToRemediate(ttr.data ?? []),
    trend: trendSeries(logs, now, TREND_DAYS, DASHBOARD_TIME_ZONE),
    atRisk: [...scoreRows].sort((a, b) => (a.score ?? 100) - (b.score ?? 100)).slice(0, 5),
    recentScans: recent.data ?? [],
  };
}
