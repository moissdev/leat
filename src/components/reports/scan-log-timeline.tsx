import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { ScanLog } from "@/lib/reports/queries";
import { describeScanLog } from "@/lib/reports/summaries";

const DOT: Record<string, string> = {
  info: "border-accent",
  warn: "border-sev-medium",
  error: "border-status-active",
};

/** Bitácora de un escaneo (`scan_logs`): solo metadatos, nunca código ni secretos. */
export function ScanLogTimeline({ logs }: { logs: ScanLog[] }) {
  if (logs.length === 0) return <p className="text-sm text-fg-muted">Sin eventos registrados.</p>;
  return (
    <ol className="flex flex-col">
      {logs.map((log, i) => {
        const { title, detail } = describeScanLog(log.event, log.metadata);
        return (
          <li key={log.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < logs.length - 1 ? (
              <span aria-hidden="true" className="absolute top-4 left-[5px] h-full w-px bg-line" />
            ) : null}
            <span
              aria-hidden="true"
              className={cn("mt-1.5 size-[11px] shrink-0 rounded-full border-2 bg-surface", DOT[log.level] ?? "border-line")}
            />
            <div className="min-w-0">
              <p className="text-sm text-fg">{title}</p>
              {detail ? <p className="text-xs text-fg-muted">{detail}</p> : null}
              <p className="text-xs text-fg-subtle">{formatDateTime(log.created_at)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
