import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LifecycleTimeline } from "@/components/findings/lifecycle-timeline";
import { OccurrenceInspector } from "@/components/findings/occurrence-inspector";
import { StatusForm } from "@/components/findings/status-form";
import { Card, CardTitle } from "@/components/ui/card";
import { MaskedValue } from "@/components/ui/masked-value";
import { PageHeader } from "@/components/ui/page-header";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { getFinding, listFindingLifecycle, listFindingOccurrences } from "@/lib/findings/queries";
import { formatDateTime } from "@/lib/format";
import { DETECTION_METHOD_LABELS, secretTypeLabel } from "@/lib/i18n/labels";
import { projectIdSchema } from "@/lib/projects/schemas";

export const metadata: Metadata = { title: "Hallazgo · LEAT" };

export default async function FindingPage({ params }: PageProps<"/findings/[id]">) {
  const { id } = await params;
  if (!projectIdSchema.safeParse(id).success) notFound();

  const [finding, occurrences, lifecycle] = await Promise.all([
    getFinding(id),
    listFindingOccurrences(id),
    listFindingLifecycle(id),
  ]);
  if (!finding) notFound();

  const facts: [string, React.ReactNode][] = [
    ["Valor", <MaskedValue key="v" value={finding.masked_value} className="text-sm" />],
    [
      "Proyecto",
      <Link key="p" href={`/projects/${finding.project_id}`} className="text-accent hover:underline">
        {finding.project_name}
      </Link>,
    ],
    ["Método", DETECTION_METHOD_LABELS[finding.method]],
    ["Primera detección", formatDateTime(finding.first_detected_at)],
    ["Última detección", formatDateTime(finding.last_detected_at)],
    ["Huella", <code key="h" className="font-mono text-xs text-fg-subtle">{finding.fingerprint.slice(0, 16)}…</code>],
  ];

  return (
    <>
      <PageHeader
        title={secretTypeLabel(finding.secret_type)}
        description="Inspección del hallazgo. El secreto solo se muestra enmascarado."
        action={
          <Link href="/findings" className="text-sm text-accent hover:underline">
            Volver a hallazgos
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SeverityBadge severity={finding.severity} />
        <StatusBadge status={finding.status} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {facts.map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-fg-subtle">{label}</dt>
                  <dd className="mt-0.5 truncate text-sm text-fg">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardTitle>Ocurrencias ({occurrences.length})</CardTitle>
            <OccurrenceInspector
              maskedValue={finding.masked_value}
              occurrences={occurrences.map((o) => ({ ...o, when: formatDateTime(o.createdAt) }))}
            />
          </Card>

          <Card>
            <CardTitle>Historial</CardTitle>
            <LifecycleTimeline entries={lifecycle} />
          </Card>
        </div>

        <Card className="h-fit">
          <CardTitle>Cambiar estado</CardTitle>
          <StatusForm findingId={finding.id} current={finding.status} />
        </Card>
      </div>
    </>
  );
}
