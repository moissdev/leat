import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

/** Lecturas de proyectos y escaneos con la sesión del usuario (RLS). */

export interface ProjectSummary {
  id: string;
  name: string;
  githubOwner: string | null;
  githubRepo: string | null;
  createdAt: string;
  score: number;
  activeCritical: number;
  activeHigh: number;
  activeMedium: number;
  activeLow: number;
}

type ScoreRow = Tables<"project_score_v">;

function withScore(project: Tables<"projects">, score: ScoreRow | undefined): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    githubOwner: project.github_owner,
    githubRepo: project.github_repo,
    createdAt: project.created_at,
    score: score?.score ?? 100,
    activeCritical: Number(score?.active_critical ?? 0),
    activeHigh: Number(score?.active_high ?? 0),
    activeMedium: Number(score?.active_medium ?? 0),
    activeLow: Number(score?.active_low ?? 0),
  };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const supabase = await createSupabaseServerClient();
  const [projects, scores] = await Promise.all([
    supabase.from("projects").select("*").order("created_at", { ascending: false }),
    supabase.from("project_score_v").select("*"),
  ]);
  const byId = new Map((scores.data ?? []).map((s) => [s.project_id, s]));
  return (projects.data ?? []).map((p) => withScore(p, byId.get(p.id)));
}

export async function getProject(id: string): Promise<ProjectSummary | null> {
  const supabase = await createSupabaseServerClient();
  const [project, score] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase.from("project_score_v").select("*").eq("project_id", id).maybeSingle(),
  ]);
  return project.data ? withScore(project.data, score.data ?? undefined) : null;
}

export type ScanReport = Tables<"scan_report_v">;

export async function listProjectScans(projectId: string, limit = 20): Promise<ScanReport[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("scan_report_v")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getScanReport(scanId: string): Promise<ScanReport | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("scan_report_v").select("*").eq("id", scanId).maybeSingle();
  return data;
}

export interface ScanOccurrence {
  filePath: string;
  lineNumber: number;
  maskedContext: string;
  finding: Pick<Tables<"findings">, "id" | "secret_type" | "severity" | "status" | "masked_value" | "method">;
}

/** Ocurrencias de un escaneo con su hallazgo (solo datos enmascarados). */
export async function listScanOccurrences(scanId: string): Promise<ScanOccurrence[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("finding_occurrences")
    .select("file_path, line_number, masked_context, findings!inner(id, secret_type, severity, status, masked_value, method)")
    .eq("scan_id", scanId)
    .order("file_path")
    .order("line_number")
    .limit(500);
  return (data ?? []).map((row) => ({
    filePath: row.file_path,
    lineNumber: row.line_number,
    maskedContext: row.masked_context,
    finding: row.findings,
  }));
}
