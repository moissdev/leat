import { cn } from "@/lib/cn";

interface FieldProps {
  name: string;
  label: string;
  type: "email" | "password";
  autoComplete: string;
  defaultValue?: string;
  error?: string;
}

export function AuthField({ name, label, type, autoComplete, defaultValue, error }: FieldProps) {
  const errorId = `${name}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium text-fg">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "h-10 rounded-lg border bg-raised px-3 text-sm text-fg placeholder:text-fg-subtle",
          "focus:border-accent focus:outline-none",
          error ? "border-threat" : "border-line",
        )}
      />
      {error ? (
        <p id={errorId} className="text-xs text-threat-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormAlert({ kind, children }: { kind: "error" | "info"; children: string }) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        kind === "error" ? "border-threat/60 bg-threat/15 text-threat-fg" : "border-accent/50 bg-accent/10 text-fg",
      )}
    >
      {children}
    </p>
  );
}
