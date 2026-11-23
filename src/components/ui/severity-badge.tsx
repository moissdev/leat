import { cn } from "@/lib/cn";
import { SEVERITY_LABELS, type Severity } from "@/lib/i18n/labels";

/** Fondo translúcido, borde y texto claro del mismo tono (validado en el checkpoint 14). */
const STYLES: Record<Severity, string> = {
  critical: "bg-sev-critical/30 border-sev-critical/55 text-sev-critical-fg",
  high: "bg-sev-high/28 border-sev-high/55 text-sev-high-fg",
  medium: "bg-sev-medium/24 border-sev-medium/50 text-sev-medium-fg",
  low: "bg-sev-low/40 border-sev-low/75 text-sev-low-fg",
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        STYLES[severity],
        className,
      )}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
