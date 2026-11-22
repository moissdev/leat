"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeNextPath } from "./redirect";
import { loginSchema, signupSchema } from "./schemas";

export interface AuthFormState {
  /** Mensaje de error general para mostrar en el formulario. */
  error?: string;
  /** Mensaje de éxito (p. ej. "revisa tu correo"). */
  message?: string;
  /** Errores por campo devueltos por zod. */
  fieldErrors?: Partial<Record<"email" | "password" | "confirmPassword", string>>;
  /** Correo ya escrito, para no obligar a teclearlo de nuevo (nunca la contraseña). */
  email?: string;
}

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Inicia sesión con correo y contraseña.
 * El mensaje de error es genérico a propósito: no revela si la cuenta existe
 * ni si falta confirmar el correo (evita enumeración de usuarios).
 */
export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: readString(formData, "email"),
    password: readString(formData, "password"),
  });
  const email = readString(formData, "email");

  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    return {
      email,
      fieldErrors: { email: flat.email?.[0], password: flat.password?.[0] },
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return {
      email,
      error: "Correo o contraseña incorrectos, o la cuenta aún no está confirmada.",
    };
  }

  redirect(safeNextPath(readString(formData, "next")));
}

/**
 * Registra una cuenta. Con la confirmación por correo activa, Supabase no crea
 * sesión hasta que el usuario abre el enlace (/auth/confirm).
 * La respuesta de éxito es la misma exista o no la cuenta (anti-enumeración).
 */
export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = readString(formData, "email");
  const parsed = signupSchema.safeParse({
    email,
    password: readString(formData, "password"),
    confirmPassword: readString(formData, "confirmPassword"),
  });

  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    return {
      email,
      fieldErrors: {
        email: flat.email?.[0],
        password: flat.password?.[0],
        confirmPassword: flat.confirmPassword?.[0],
      },
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    if (error.code === "weak_password") {
      return { email, fieldErrors: { password: "La contraseña es demasiado débil." } };
    }
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return { email, error: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo." };
    }
    return { email, error: "No se pudo completar el registro. Inténtalo de nuevo." };
  }

  return {
    message:
      "Si el correo es válido, te enviamos un enlace de confirmación. Ábrelo para activar tu cuenta.",
  };
}

/** Cierra la sesión y vuelve a /login. */
export async function logout(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
