import { Suspense } from "react";
import { logout } from "@/lib/auth/actions";
import { getSessionUser, requireUser } from "@/lib/supabase/session";

/**
 * Layout provisional de la aplicación autenticada.
 * La barra lateral y el tema definitivos llegan en el checkpoint 14.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-current/10 px-6 py-3">
        <span className="font-semibold">LEAT</span>
        <Suspense fallback={null}>
          <UserMenu />
        </Suspense>
      </header>
      <Suspense fallback={<p className="p-6 text-sm opacity-70">Cargando…</p>}>
        <AuthGate>{children}</AuthGate>
      </Suspense>
    </div>
  );
}

/** Segunda barrera tras el proxy: sin sesión verificada no se renderiza la página. */
async function AuthGate({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <main className="flex-1 p-6">{children}</main>;
}

async function UserMenu() {
  const user = await getSessionUser();
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="opacity-70">{user.email}</span>
      <form action={logout}>
        <button type="submit" className="rounded border border-current/20 px-3 py-1">
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}
