/**
 * Lectura validada de variables de entorno de Supabase.
 *
 * Las públicas se leen con acceso literal a `process.env.NEXT_PUBLIC_*` para que
 * Next las incruste en el bundle del navegador. La clave `service_role` NO se lee
 * aquí: solo en `admin.ts`, que es exclusivo del servidor.
 */

/** Devuelve el valor o lanza un error con el NOMBRE de la variable, nunca con su valor. */
export function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

/**
 * La URL debe ser solo el origen del proyecto (`https://<ref>.supabase.co`).
 * Si incluye una ruta como `/rest/v1/`, supabase-js la duplica y todas las
 * consultas fallan con 404 (PGRST125).
 */
function requireProjectUrl(name: string, value: string | undefined): string {
  const raw = requireEnv(name, value);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} no es una URL válida`);
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if ((parsed.protocol !== "https:" && !isLocal) || parsed.pathname !== "/" || parsed.search) {
    throw new Error(`${name} debe ser solo el origen del proyecto, p. ej. https://<ref>.supabase.co`);
  }
  return parsed.origin;
}

export function getSupabasePublicEnv(): { url: string; anonKey: string } {
  return {
    url: requireProjectUrl("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: requireEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}
