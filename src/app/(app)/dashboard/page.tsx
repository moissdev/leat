import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { ButtonLink, Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { MaskedValue } from "@/components/ui/masked-value";
import { PageHeader } from "@/components/ui/page-header";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { FINDING_STATUS_LABELS, SEVERITY_ORDER, type FindingStatus } from "@/lib/i18n/labels";

export const metadata: Metadata = { title: "Dashboard · LEAT" };

const STATUSES = Object.keys(FINDING_STATUS_LABELS) as FindingStatus[];

/**
 * Provisional: muestra los componentes base del tema para la revisión visual
 * (checkpoint 14). El dashboard real (KPIs, score y gráficas) es el checkpoint 16.
 */
export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Resumen de exposición de tus proyectos."
        action={
          <ButtonLink href="/scans/new" variant="primary">
            <Plus className="size-4" aria-hidden="true" />
            Nuevo escaneo
          </ButtonLink>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Severidades</CardTitle>
          <div className="flex flex-wrap gap-2">
            {SEVERITY_ORDER.map((severity) => (
              <SeverityBadge key={severity} severity={severity} />
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Estados</CardTitle>
          <div className="flex flex-wrap gap-4">
            {STATUSES.map((status) => (
              <StatusBadge key={status} status={status} />
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Botones</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary">Primario</Button>
            <Button variant="secondary">Secundario</Button>
            <Button variant="ghost">Discreto</Button>
            <Button variant="danger">Eliminar</Button>
          </div>
        </Card>

        <Card>
          <CardTitle>Valor enmascarado y barra</CardTitle>
          <div className="flex flex-col gap-3">
            <MaskedValue value="AKIA...MPLE" />
            <div className="h-1.5 rounded-full bg-track">
              <div className="h-1.5 w-[72%] rounded-full bg-assess" />
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
