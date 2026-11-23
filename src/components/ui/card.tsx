import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Tarjeta sólida: superficie, borde fino y radio de 12 px. */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-xl border border-line bg-surface p-4", className)} {...props} />;
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-medium text-fg-muted">{children}</h2>
      {action}
    </div>
  );
}
