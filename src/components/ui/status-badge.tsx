import { cn } from "@/lib/cn";
import { FINDING_STATUS_LABELS, type FindingStatus } from "@/lib/i18n/labels";

/** Punto del color del estado + texto en su tono claro (legible sobre fondo oscuro). */
const STYLES: Record<FindingStatus, { dot: string; text: string }> = {
  active: { dot: "bg-status-active", text: "text-status-active-fg" },
  resolved: { dot: "bg-status-resolved", text: "text-status-resolved-fg" },
  ignored: { dot: "bg-status-ignored", text: "text-status-ignored-fg" },
  false_positive: { dot: "bg-status-false-positive", text: "text-status-false-positive-fg" },
};

export function StatusBadge({ status, className }: { status: FindingStatus; className?: string }) {
  const style = STYLES[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap", style.text, className)}>
      <span aria-hidden="true" className={cn("size-2 rounded-full", style.dot)} />
      {FINDING_STATUS_LABELS[status]}
    </span>
  );
}
