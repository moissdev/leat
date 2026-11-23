import { StatusBadge } from "@/components/ui/status-badge";
import type { LifecycleEntry } from "@/lib/findings/queries";
import { formatDateTime } from "@/lib/format";

/** Motivos que escribe el sistema, en español. */
const SYSTEM_REASONS: Record<string, string> = {
  first_detected: "Primera detección",
  redetected: "Detectado de nuevo en un escaneo",
  no_longer_detected: "Ya no apareció en un escaneo completo",
};

function formatTtr(seconds: number): string {
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

/** Historial de transiciones del hallazgo (lo escribe el trigger de la base). */
export function LifecycleTimeline({ entries }: { entries: LifecycleEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-fg-muted">Sin transiciones registradas.</p>;
  return (
    <ol className="flex flex-col">
      {entries.map((e, i) => (
        <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
          {i < entries.length - 1 ? (
            <span aria-hidden="true" className="absolute top-4 left-[5px] h-full w-px bg-line" />
          ) : null}
          <span aria-hidden="true" className="mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-line bg-surface" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {e.from_status ? (
                <>
                  <StatusBadge status={e.from_status} />
                  <span className="text-fg-subtle">→</span>
                </>
              ) : null}
              <StatusBadge status={e.to_status} />
              <span className="text-fg-subtle">· {e.actor === "system" ? "Sistema" : "Tú"}</span>
            </div>
            {e.reason ? (
              <p className="text-sm break-words text-fg-muted">{SYSTEM_REASONS[e.reason] ?? e.reason}</p>
            ) : null}
            <p className="text-xs text-fg-subtle">
              {formatDateTime(e.created_at)}
              {e.ttr_seconds !== null ? ` · resuelto en ${formatTtr(e.ttr_seconds)}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
