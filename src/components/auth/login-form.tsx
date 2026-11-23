"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { login, type AuthFormState } from "@/lib/auth/actions";
import { buttonClasses } from "@/components/ui/button";
import { AuthField, FormAlert } from "./auth-form-fields";

const QUERY_ERRORS: Record<string, string> = {
  confirmation: "El enlace de confirmación no es válido o ya expiró.",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(login, {});
  const queryError = QUERY_ERRORS[searchParams.get("error") ?? ""];

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {/* El servidor vuelve a sanear este valor con safeNextPath. */}
      <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
      {state.error ? <FormAlert kind="error">{state.error}</FormAlert> : null}
      {!state.error && queryError ? <FormAlert kind="error">{queryError}</FormAlert> : null}

      <AuthField
        name="email"
        label="Correo"
        type="email"
        autoComplete="email"
        defaultValue={state.email}
        error={state.fieldErrors?.email}
      />
      <AuthField
        name="password"
        label="Contraseña"
        type="password"
        autoComplete="current-password"
        error={state.fieldErrors?.password}
      />

      <button
        type="submit"
        disabled={pending}
        className={buttonClasses("primary", "md", "w-full")}
      >
        {pending ? "Entrando…" : "Iniciar sesión"}
      </button>
      <p className="text-center text-sm text-fg-muted">
        ¿No tienes cuenta?{" "}
        <Link href="/signup" className="text-accent hover:underline">
          Regístrate
        </Link>
      </p>
    </form>
  );
}
