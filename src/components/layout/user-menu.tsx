import { LogOut } from "lucide-react";
import { logout } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/supabase/session";

/** Correo del usuario y cierre de sesión (al pie de la barra lateral). */
export async function UserMenu() {
  const user = await getSessionUser();
  if (!user) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate text-xs text-fg-muted" title={user.email ?? undefined}>
        {user.email}
      </span>
      <form action={logout}>
        <button
          type="submit"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="rounded-lg p-2 text-fg-muted hover:bg-raised hover:text-fg"
        >
          <LogOut className="size-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
