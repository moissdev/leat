"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signup, type AuthFormState } from "@/lib/auth/actions";
import { PASSWORD_MIN } from "@/lib/auth/schemas";
import { buttonClasses } from "@/components/ui/button";
import { AuthField, FormAlert } from "./auth-form-fields";

export function SignupForm() {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(signup, {});

  if (state.message) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert kind="info">{state.message}</FormAlert>
        <Link href="/login" className="text-sm text-accent hover:underline">
          Volver a iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.error ? <FormAlert kind="error">{state.error}</FormAlert> : null}

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
        label={`Contraseña (mínimo ${PASSWORD_MIN} caracteres)`}
        type="password"
        autoComplete="new-password"
        error={state.fieldErrors?.password}
      />
      <AuthField
        name="confirmPassword"
        label="Confirmar contraseña"
        type="password"
        autoComplete="new-password"
        error={state.fieldErrors?.confirmPassword}
      />

      <button
        type="submit"
        disabled={pending}
        className={buttonClasses("primary", "md", "w-full")}
      >
        {pending ? "Creando cuenta…" : "Crear cuenta"}
      </button>
      <p className="text-center text-sm text-fg-muted">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Inicia sesión
        </Link>
      </p>
    </form>
  );
}
