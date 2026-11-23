import type { Metadata } from "next";
import { AlertLogTable } from "@/components/reports/alert-log-table";
import { WebhookSettings } from "@/components/settings/webhook-settings";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { listAlertLogs } from "@/lib/reports/queries";
import { getAlertSettings } from "@/lib/settings/queries";

export const metadata: Metadata = { title: "Configuración · LEAT" };

export default async function SettingsPage() {
  const [settings, alerts] = await Promise.all([getAlertSettings(), listAlertLogs({ limit: 10 })]);

  return (
    <>
      <PageHeader title="Configuración" description="Alertas a Discord cuando un escaneo encuentra secretos graves." />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardTitle>Alertas a Discord</CardTitle>
            <WebhookSettings configured={settings.webhookConfigured} alertsEnabled={settings.alertsEnabled} />
          </Card>
          <Card>
            <CardTitle>Últimas entregas</CardTitle>
            <AlertLogTable logs={alerts} />
          </Card>
        </div>

        <Card className="h-fit">
          <CardTitle>Cómo funcionan</CardTitle>
          <ul className="flex list-disc flex-col gap-2 pl-4 text-sm text-fg-muted">
            <li>Se envía un mensaje por escaneo, solo con hallazgos nuevos o reabiertos de severidad Alta o Crítica.</li>
            <li>El mensaje lleva únicamente valores enmascarados, nunca el secreto.</li>
            <li>Si Discord falla, se reintenta hasta 3 veces; cada intento queda en Informes.</li>
            <li>
              Para crear el webhook: en tu servidor de Discord, Editar canal → Integraciones → Webhooks → Nuevo webhook →
              Copiar URL.
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
