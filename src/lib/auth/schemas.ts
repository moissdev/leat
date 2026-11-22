import { z } from "zod";

/** Supabase Auth usa bcrypt, que solo considera los primeros 72 bytes. */
const PASSWORD_MAX = 72;
export const PASSWORD_MIN = 8;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "El correo es demasiado largo.")
  .pipe(z.email("Escribe un correo válido."));

export const loginSchema = z.object({
  email,
  password: z
    .string()
    .min(1, "Escribe tu contraseña.")
    .max(PASSWORD_MAX, "La contraseña es demasiado larga."),
});

export const signupSchema = z
  .object({
    email,
    password: z
      .string()
      .min(PASSWORD_MIN, `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`)
      .max(PASSWORD_MAX, "La contraseña es demasiado larga."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });

/** Tipos de enlace de correo que acepta /auth/confirm. */
export const emailOtpTypeSchema = z.enum(["email", "signup"]);
