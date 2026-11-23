import { cn } from "@/lib/cn";

/** Valor enmascarado de un secreto, siempre en monoespaciada. */
export function MaskedValue({ value, className }: { value: string; className?: string }) {
  return <code className={cn("font-mono text-xs text-fg-muted", className)}>{value}</code>;
}
