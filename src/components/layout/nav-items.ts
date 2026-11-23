import { FileChartColumn, FolderGit2, KeyRound, LayoutDashboard, ScanSearch, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Secciones de la aplicación, en el orden de la barra lateral. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Proyectos", icon: FolderGit2 },
  { href: "/scans/new", label: "Nuevo escaneo", icon: ScanSearch },
  { href: "/findings", label: "Hallazgos", icon: KeyRound },
  { href: "/reports", label: "Informes", icon: FileChartColumn },
  { href: "/settings", label: "Configuración", icon: Settings },
];

/** Una sección está activa en su ruta y en sus subrutas (`/findings/123`). */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
