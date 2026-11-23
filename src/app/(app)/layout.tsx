import { Suspense } from "react";
import { AppNav, NavLinks } from "@/components/layout/app-nav";
import { Brand } from "@/components/layout/brand";
import { MobileNav } from "@/components/layout/mobile-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { requireUser } from "@/lib/supabase/session";

/** Layout de la aplicación autenticada: barra lateral (escritorio) o barra superior (móvil). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const userMenu = (
    <Suspense fallback={null}>
      <UserMenu />
    </Suspense>
  );

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col justify-between border-r border-line bg-surface py-5 md:flex md:sticky md:top-0 md:h-screen">
        <div className="flex flex-col gap-6">
          <Brand />
          <Suspense fallback={<NavLinks pathname={null} />}>
            <AppNav />
          </Suspense>
        </div>
        <div className="border-t border-line px-3 pt-4">{userMenu}</div>
      </aside>

      <Suspense fallback={null}>
        <MobileNav brand={<Brand />} userMenu={userMenu} />
      </Suspense>

      <Suspense fallback={<p className="p-8 text-sm text-fg-muted">Cargando…</p>}>
        <AuthGate>{children}</AuthGate>
      </Suspense>
    </div>
  );
}

/** Segunda barrera tras el proxy: sin sesión verificada no se renderiza la página. */
async function AuthGate({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>;
}
