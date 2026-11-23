import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { FindingsFilters } from "@/components/findings/findings-filters";
import { Card } from "@/components/ui/card";
import { MaskedValue } from "@/components/ui/masked-value";
import { PageHeader } from "@/components/ui/page-header";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { listFindings, listFindingTypes, listProjectOptions } from "@/lib/findings/queries";
import { FINDINGS_PAGE_SIZE, findingFiltersSchema, type FindingFilters } from "@/lib/findings/schemas";
import { formatDateTime, formatNumber } from "@/lib/format";
import { secretTypeLabel } from "@/lib/i18n/labels";

export const metadata: Metadata = { title: "Hallazgos · LEAT" };

/** Enlace a otra página conservando los filtros actuales. */
function pageHref(filters: FindingFilters, page: number): string {
  const params = new URLSearchParams();
  for (const key of ["severity", "status", "project", "type"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/findings?${query}` : "/findings";
}

export default async function FindingsPage({ searchParams }: PageProps<"/findings">) {
  const filters = findingFiltersSchema.parse(await searchParams);
  const [{ items, total }, projects, types] = await Promise.all([
    listFindings(filters),
    listProjectOptions(),
    listFindingTypes(),
  ]);
  const pages = Math.max(1, Math.ceil(total / FINDINGS_PAGE_SIZE));

  return (
    <>
      <PageHeader title="Hallazgos" description="Secretos detectados en tus proyectos. Solo se muestran enmascarados." />
      <FindingsFilters filters={filters} projects={projects} types={types} />

      <Card className="p-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <ShieldCheck className="size-8 text-status-resolved-fg" aria-hidden="true" />
            <p className="font-medium text-fg">Sin hallazgos con estos filtros</p>
            <p className="text-sm text-fg-muted">Cambia los filtros o escanea un proyecto.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-xs text-fg-subtle">
                  <th className="px-4 py-3 font-normal">Severidad</th>
                  <th className="px-4 py-3 font-normal">Tipo</th>
                  <th className="px-4 py-3 font-normal">Valor</th>
                  <th className="px-4 py-3 font-normal">Proyecto</th>
                  <th className="px-4 py-3 font-normal">Última detección</th>
                  <th className="px-4 py-3 font-normal">Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((f) => (
                  <tr key={f.id} className="border-t border-line hover:bg-raised">
                    <td className="px-4 py-3">
                      <SeverityBadge severity={f.severity} />
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/findings/${f.id}`} className="text-fg hover:text-accent">
                        {secretTypeLabel(f.secret_type)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <MaskedValue value={f.masked_value} />
                    </td>
                    <td className="px-4 py-3 text-fg-muted">{f.project_name}</td>
                    <td className="px-4 py-3 text-fg-muted">{formatDateTime(f.last_detected_at)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={f.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <nav aria-label="Paginación" className="mt-4 flex items-center justify-between text-sm text-fg-muted">
        <span>
          {formatNumber(total)} {total === 1 ? "hallazgo" : "hallazgos"}
          {pages > 1 ? ` · página ${filters.page} de ${pages}` : ""}
        </span>
        <div className="flex gap-2">
          {filters.page > 1 ? (
            <Link href={pageHref(filters, filters.page - 1)} className="text-accent hover:underline">
              Anterior
            </Link>
          ) : null}
          {filters.page < pages ? (
            <Link href={pageHref(filters, filters.page + 1)} className="text-accent hover:underline">
              Siguiente
            </Link>
          ) : null}
        </div>
      </nav>
    </>
  );
}
