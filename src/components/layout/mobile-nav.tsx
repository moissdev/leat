"use client";

import { Menu, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AppNav } from "./app-nav";

/** Barra superior en pantallas pequeñas, con la navegación desplegable. */
export function MobileNav({ brand, userMenu }: { brand: ReactNode; userMenu: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line bg-surface md:hidden">
      <div className="flex items-center justify-between py-3 pr-3">
        {brand}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          className="rounded-lg p-2 text-fg-muted hover:bg-raised hover:text-fg"
        >
          {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
        </button>
      </div>
      {open ? (
        <div id="mobile-nav" className="flex flex-col gap-3 pb-3">
          <AppNav onNavigate={() => setOpen(false)} />
          <div className="border-t border-line px-3 pt-3">{userMenu}</div>
        </div>
      ) : null}
    </div>
  );
}
