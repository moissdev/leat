import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { SEVERITY_LABELS, SEVERITY_ORDER, type Severity } from "@/lib/i18n/labels";

/** Barra sólida por severidad (colores validados por el usuario en el checkpoint 14). */
const BAR: Record<Severity, string> = {
  critical: "bg-sev-critical",
  high: "bg-sev-high",
  medium: "bg-sev-medium",
  low: "bg-sev-low",
};

/**
 * Hallazgos activos por severidad en barras horizontales. Cada barra lleva su
 * etiqueta y su número: el color refuerza, nunca es la única señal.
 */
export function SeverityBars({ totals }: { totals: Record<Severity, number> }) {
  const max = Math.max(1, ...SEVERITY_ORDER.map((s) => totals[s]));
  return (
    <ul className="flex flex-col gap-3" aria-label="Hallazgos activos por severidad">
      {SEVERITY_ORDER.map((severity) => {
        const value = totals[severity];
        return (
          <li key={severity} className="grid grid-cols-[64px_minmax(0,1fr)_40px] items-center gap-3">
            <span className="text-xs text-fg-muted">{SEVERITY_LABELS[severity]}</span>
            <span className="h-2.5 rounded-full bg-track">
              <span
                className={cn("block h-2.5 rounded-full", BAR[severity], value === 0 && "hidden")}
                style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
              />
            </span>
            <span className="text-right text-sm font-medium text-fg tabular-nums">{formatNumber(value)}</span>
          </li>
        );
      })}
    </ul>
  );
}
