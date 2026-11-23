import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type TextFieldProps = Omit<ComponentProps<"input">, "id"> & {
  name: string;
  label: string;
  hint?: string;
  error?: string;
};

/** Campo de texto con etiqueta, ayuda y error accesibles. */
export function TextField({ name, label, hint, error, className, ...props }: TextFieldProps) {
  const describedBy = [hint ? `${name}-hint` : null, error ? `${name}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium text-fg">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={cn(
          "h-10 rounded-lg border bg-raised px-3 text-sm text-fg placeholder:text-fg-subtle",
          "focus:border-accent focus:outline-none",
          error ? "border-threat" : "border-line",
          className,
        )}
        {...props}
      />
      {hint && !error ? (
        <p id={`${name}-hint`} className="text-xs text-fg-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="text-xs text-threat-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Mensaje de error o éxito de un formulario. */
export function FormMessage({ kind, children }: { kind: "error" | "success"; children: string }) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        kind === "error"
          ? "border-threat/60 bg-threat/15 text-threat-fg"
          : "border-status-resolved/50 bg-status-resolved/10 text-status-resolved-fg",
      )}
    >
      {children}
    </p>
  );
}
