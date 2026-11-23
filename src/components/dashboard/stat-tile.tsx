import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Cifra clave: etiqueta, número grande y una línea de contexto. */
export function StatTile({
  label,
  value,
  hint,
  valueClassName,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className={cn("mt-1 text-3xl font-semibold text-fg", valueClassName)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-fg-subtle">{hint}</p> : null}
      {children}
    </div>
  );
}
