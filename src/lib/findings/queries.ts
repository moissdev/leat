import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";
import { FINDINGS_PAGE_SIZE, type FindingFilters } from "./schemas";

/** Lecturas de hallazgos con la sesión del usuario (RLS). Solo datos enmascarados. */

export type FindingListItem = Pick<
  Tables<"findings">,
  "id" | "secret_type" | "severity" | "status" | "masked_value" | "method" | "last_detected_at" | "project_id"
> & { project_name: string };

export async function listFindings(filters: FindingFilters): Promise<{ items: FindingListItem[]; total: number }> {
  const supabase = await createSupabaseServerClient();
  let query = supabase
    .from("findings")
    .select("id, secret_type, severity, status, masked_value, method, last_detected_at, project_id, projects!inner(name)", {
      count: "exact",
    });

  if (filters.severity) query = query.eq("severity", filters.severity);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.project) query = query.eq("project_id", filters.project);
  if (filters.type) query = query.eq("secret_type", filters.type);

  const from = (filters.page - 1) * FINDINGS_PAGE_SIZE;
  const { data, count } = await query
    // El enum se ordena por declaración: critical, high, medium, low.
    .order("severity", { ascending: true })
    .order("last_detected_at", { ascending: false })
    .range(from, from + FINDINGS_PAGE_SIZE - 1);

  return {
    total: count ?? 0,
    items: (data ?? []).map(({ projects, ...f }) => ({ ...f, project_name: projects.name })),
  };
}

/** Tipos de secreto presentes en los hallazgos del usuario (para el filtro). */
export async function listFindingTypes(): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("findings").select("secret_type").limit(1000);
  return [...new Set((data ?? []).map((r) => r.secret_type))].sort();
}

export type FindingDetail = Tables<"findings"> & { project_name: string };

export async function getFinding(id: string): Promise<FindingDetail | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("findings").select("*, projects!inner(name)").eq("id", id).maybeSingle();
  if (!data) return null;
  const { projects, ...finding } = data;
  return { ...finding, project_name: projects.name };
}

export interface FindingOccurrence {
  id: string;
  scanId: string;
  filePath: string;
  lineNumber: number;
  maskedContext: string;
  createdAt: string;
}

export async function listFindingOccurrences(findingId: string): Promise<FindingOccurrence[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("finding_occurrences")
    .select("id, scan_id, file_path, line_number, masked_context, created_at")
    .eq("finding_id", findingId)
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((o) => ({
    id: o.id,
    scanId: o.scan_id,
    filePath: o.file_path,
    lineNumber: o.line_number,
    maskedContext: o.masked_context,
    createdAt: o.created_at,
  }));
}

export type LifecycleEntry = Pick<
  Tables<"vulnerability_lifecycle_logs">,
  "id" | "from_status" | "to_status" | "actor" | "reason" | "ttr_seconds" | "created_at"
>;

export async function listFindingLifecycle(findingId: string): Promise<LifecycleEntry[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("vulnerability_lifecycle_logs")
    .select("id, from_status, to_status, actor, reason, ttr_seconds, created_at")
    .eq("finding_id", findingId)
    .order("created_at", { ascending: false })
    .limit(100);
  return data ?? [];
}

/** Proyectos del usuario para el filtro. */
export async function listProjectOptions(): Promise<{ id: string; name: string }[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("projects").select("id, name").order("name");
  return data ?? [];
}
