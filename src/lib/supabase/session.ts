import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createSupabaseServerClient } from "./server";

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * Usuario de la sesión actual, con el JWT verificado (`getClaims` valida la firma).
 * Es la ÚNICA fuente válida de `user_id` en el servidor; nunca tomarlo del body.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  // La sesión depende de la petición y `getClaims()` consulta la hora para
  // validar el token: nunca debe evaluarse durante el prerender.
  await connection();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;

  const { sub, email } = data.claims;
  if (typeof sub !== "string" || sub.length === 0) return null;
  return { id: sub, email: typeof email === "string" ? email : null };
}

/** Igual que `getSessionUser`, pero redirige a /login si no hay sesión. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
