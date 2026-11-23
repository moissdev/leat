"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Tables } from "@/types/database";

export type ScanProgressRow = Pick<
  Tables<"scans">,
  | "id"
  | "status"
  | "files_total"
  | "files_scanned"
  | "files_skipped"
  | "files_truncated"
  | "bytes_scanned"
  | "chunks_received"
  | "occurrences_total"
  | "findings_new"
  | "findings_reopened"
  | "is_full_scan"
  | "error_message"
>;

const COLUMNS =
  "id, status, files_total, files_scanned, files_skipped, files_truncated, bytes_scanned, chunks_received, occurrences_total, findings_new, findings_reopened, is_full_scan, error_message";

/** Intervalo del polling de respaldo (por si Realtime no está disponible). */
const POLL_MS = 3000;

function isTerminal(status: ScanProgressRow["status"]): boolean {
  return status === "completed" || status === "failed";
}

/**
 * Sigue el progreso de un escaneo: Supabase Realtime sobre su fila de `scans`
 * (pasa por RLS) y polling cada 3 s como respaldo. Al terminar, refresca la
 * página para que el servidor cargue los resultados.
 */
export function useScanProgress(initial: ScanProgressRow): ScanProgressRow {
  const router = useRouter();
  const [scan, setScan] = useState(initial);
  const refreshed = useRef(isTerminal(initial.status));

  useEffect(() => {
    if (isTerminal(initial.status)) return;
    const supabase = createSupabaseBrowserClient();

    const apply = (row: ScanProgressRow) => {
      setScan(row);
      if (isTerminal(row.status) && !refreshed.current) {
        refreshed.current = true;
        router.refresh();
      }
    };

    const channel = supabase
      .channel(`scan-${initial.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "scans", filter: `id=eq.${initial.id}` },
        (payload) => apply(payload.new as ScanProgressRow),
      )
      .subscribe();

    const timer = setInterval(async () => {
      if (refreshed.current) return;
      const { data } = await supabase.from("scans").select(COLUMNS).eq("id", initial.id).maybeSingle();
      if (data) apply(data);
    }, POLL_MS);

    return () => {
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [initial.id, initial.status, router]);

  return scan;
}
