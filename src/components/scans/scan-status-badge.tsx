import { cn } from "@/lib/cn";
import { SCAN_STATUS_LABELS, type ScanStatus } from "@/lib/i18n/labels";

/** Estado de un escaneo con el mismo estilo de punto y texto que los hallazgos. */
const STYLES: Record<ScanStatus, { dot: string; text: string; pulse?: boolean }> = {
  queued: { dot: "bg-status-ignored", text: "text-status-ignored-fg" },
  running: { dot: "bg-accent", text: "text-accent", pulse: true },
  completed: { dot: "bg-status-resolved", text: "text-status-resolved-fg" },
  failed: { dot: "bg-status-active", text: "text-status-active-fg" },
};

export function ScanStatusBadge({ status }: { status: ScanStatus }) {
  const style = STYLES[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", style.text)}>
      <span aria-hidden="true" className={cn("size-2 rounded-full", style.dot, style.pulse && "animate-pulse")} />
      {SCAN_STATUS_LABELS[status]}
    </span>
  );
}
