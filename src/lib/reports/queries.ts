import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Constants, type Tables } from "@/types/database";

/** Lecturas de informes con la sesión del usuario (RLS). Logs de solo lectura. */

export const REPORT_PAGE_SIZE = 20;

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export const scanHistoryFiltersSchema = z.object({
  project: z.preprocess(first, z.uuid().optional().catch(undefined)),
  ingest: z.preprocess(first, z.enum(Constants.public.Enums.ingest_type).optional().catch(undefined)),
  status: z.preprocess(first, z.enum(Constants.public.Enums.scan_status).optional().catch(undefined)),
  page: z.preprocess(first, z.coerce.number().int().min(1).max(10_000).catch(1)),
});
export type ScanHistoryFilters = z.infer<typeof scanHistoryFiltersSchema>;

export async function listScanHistory(
  filters: ScanHistoryFilters,
): Promise<{ items: Tables<"scan_report_v">[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("scan_report_v").select("*", { count: "exact" });
  if (filters.project) query = query.eq("project_id", filters.project);
  if (filters.ingest) query = query.eq("ingest", filters.ingest);
  if (filters.status) query = query.eq("status", filters.status);
  const from = (filters.page - 1) * REPORT_PAGE_SIZE;
  const { data, count } = await query.order("created_at", { ascending: false }).range(from, from + REPORT_PAGE_SIZE - 1);
  return { items: data ?? [], total: count ?? 0 };
}

export async function getTtrRows() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("ttr_summary_v").select("severity, resolved_count, avg_ttr_seconds");
  return data ?? [];
}

export type AlertLog = Tables<"alert_logs">;

export async function listAlertLogs(options: { scanId?: string; limit: number }): Promise<AlertLog[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("alert_logs").select("*");
  if (options.scanId) query = query.eq("scan_id", options.scanId);
  const { data } = await query.order("created_at", { ascending: false }).order("attempt", { ascending: false }).limit(options.limit);
  return data ?? [];
}

export type ScanLog = Pick<Tables<"scan_logs">, "id" | "level" | "event" | "metadata" | "created_at">;

export async function listScanLogs(scanId: string): Promise<ScanLog[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("scan_logs")
    .select("id, level, event, metadata, created_at")
    .eq("scan_id", scanId)
    .order("id")
    .limit(500);
  return data ?? [];
}

export interface RecentTransition {
  id: number;
  findingId: string;
  secretType: string;
  maskedValue: string;
  from: Tables<"vulnerability_lifecycle_logs">["from_status"];
  to: Tables<"vulnerability_lifecycle_logs">["to_status"];
  actor: Tables<"vulnerability_lifecycle_logs">["actor"];
  reason: string | null;
  ttrSeconds: number | null;
  createdAt: string;
}

export async function listRecentTransitions(limit: number): Promise<RecentTransition[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("vulnerability_lifecycle_logs")
    .select("id, finding_id, from_status, to_status, actor, reason, ttr_seconds, created_at, findings!inner(secret_type, masked_value)")
    .order("id", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    id: r.id,
    findingId: r.finding_id,
    secretType: r.findings.secret_type,
    maskedValue: r.findings.masked_value,
    from: r.from_status,
    to: r.to_status,
    actor: r.actor,
    reason: r.reason,
    ttrSeconds: r.ttr_seconds,
    createdAt: r.created_at,
  }));
}
