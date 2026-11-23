import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_AFTER_LOGIN } from "@/lib/auth/redirect";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

/** Secciones de la aplicación que exigen sesión. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/projects",
  "/scans",
  "/findings",
  "/reports",
  "/settings",
];

/** Páginas de autenticación: con sesión activa no tiene sentido mostrarlas. */
const AUTH_PAGES = ["/login", "/signup"];

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Proxy de Next 16 (antes `middleware`):
 * 1. Refresca la sesión de Supabase y reescribe sus cookies en la respuesta.
 * 2. Redirige a /login las secciones protegidas cuando no hay sesión.
 * 3. Redirige al dashboard si un usuario con sesión abre /login o /signup.
 *
 * Es la primera barrera; el layout de la app vuelve a verificar la sesión.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabasePublicEnv();

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // getClaims() valida el JWT; no usar getSession() para decidir acceso.
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims.sub);
  const { pathname, search } = request.nextUrl;

  /** Redirección que conserva las cookies de sesión recién refrescadas. */
  const redirectTo = (target: URL) => {
    const redirect = NextResponse.redirect(target);
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  };

  if (!isAuthenticated && matchesPrefix(pathname, PROTECTED_PREFIXES)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return redirectTo(loginUrl);
  }

  if (isAuthenticated && matchesPrefix(pathname, AUTH_PAGES)) {
    return redirectTo(new URL(DEFAULT_AFTER_LOGIN, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Todo excepto rutas de API (se autentican solas y responden 401),
    // archivos estáticos, optimización de imágenes y recursos con extensión.
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
