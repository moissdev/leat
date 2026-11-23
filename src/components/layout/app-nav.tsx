"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { isActive, NAV_ITEMS } from "./nav-items";

interface NavLinksProps {
  /** Ruta actual; null mientras no se conoce (fallback de Suspense). */
  pathname: string | null;
  onNavigate?: () => void;
}

/** Enlaces de navegación. El activo: texto cian, fondo sólido y barra izquierda. */
export function NavLinks({ pathname, onNavigate }: NavLinksProps) {
  return (
    <nav aria-label="Principal" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname !== null && isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 border-l-[3px] px-3 py-2 text-sm transition-colors",
              active
                ? "border-accent bg-selected font-medium text-accent"
                : "border-transparent text-fg-muted hover:bg-raised hover:text-fg",
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Navegación con la sección activa (lee la ruta: debe ir dentro de `<Suspense>`). */
export function AppNav({ onNavigate }: { onNavigate?: () => void }) {
  return <NavLinks pathname={usePathname()} onNavigate={onNavigate} />;
}
