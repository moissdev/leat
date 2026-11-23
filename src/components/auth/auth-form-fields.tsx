// Campos de formulario provisionales (sin diseño final; se rediseñan en el checkpoint 14).

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
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
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
        className="rounded border border-current/20 bg-transparent px-3 py-2"
      />
      {error ? (
        <p id={errorId} className="text-sm text-red-500">
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
      className={`rounded border px-3 py-2 text-sm ${
        kind === "error" ? "border-red-500/40 text-red-500" : "border-current/20"
      }`}
    >
      {children}
    </p>
  );
}
