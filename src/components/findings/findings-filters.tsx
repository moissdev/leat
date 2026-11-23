import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { FindingFilters } from "@/lib/findings/schemas";
import { FINDING_STATUS_LABELS, SEVERITY_LABELS, SEVERITY_ORDER, secretTypeLabel, type FindingStatus } from "@/lib/i18n/labels";

const selectClasses =
  "h-9 rounded-lg border border-line bg-raised px-2 text-sm text-fg focus:border-accent focus:outline-none";

interface Props {
  filters: FindingFilters;
  projects: { id: string; name: string }[];
  types: string[];
}

/** Filtros en un formulario GET (la URL es el estado: se puede compartir y recargar). */
export function FindingsFilters({ filters, projects, types }: Props) {
  const active = Boolean(filters.severity || filters.status || filters.project || filters.type);
  return (
    <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filtros de hallazgos">
      <Filter label="Severidad" name="severity" value={filters.severity}>
        {SEVERITY_ORDER.map((s) => (
          <option key={s} value={s}>
            {SEVERITY_LABELS[s]}
          </option>
        ))}
      </Filter>
      <Filter label="Estado" name="status" value={filters.status}>
        {(Object.keys(FINDING_STATUS_LABELS) as FindingStatus[]).map((s) => (
          <option key={s} value={s}>
            {FINDING_STATUS_LABELS[s]}
          </option>
        ))}
      </Filter>
      <Filter label="Proyecto" name="project" value={filters.project}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Filter>
      <Filter label="Tipo" name="type" value={filters.type}>
        {types.map((t) => (
          <option key={t} value={t}>
            {secretTypeLabel(t)}
          </option>
        ))}
      </Filter>
      <button type="submit" className={buttonClasses("secondary", "sm", "h-9")}>
        Filtrar
      </button>
      {active ? (
        <Link href="/findings" className="h-9 px-2 text-sm leading-9 text-fg-muted hover:text-fg">
          Limpiar
        </Link>
      ) : null}
    </form>
  );
}

function Filter({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-fg-subtle">
      {label}
      <select name={name} defaultValue={value ?? ""} className={cn(selectClasses, "min-w-36")}>
        <option value="">Todos</option>
        {children}
      </select>
    </label>
  );
}
