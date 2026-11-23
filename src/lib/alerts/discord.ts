import { z } from "zod";

/**
 * Webhook de Discord: validación estricta de la URL (anti SSRF) y construcción
 * del embed de alerta. El payload SOLO lleva datos enmascarados.
 */

/** `https://discord.com/api/webhooks/<id>/<token>` (también discordapp.com, ptb. y canary.). */
const WEBHOOK_URL = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d{1,2})?\/webhooks\/(\d{17,20})\/([A-Za-z0-9_-]{60,100})$/;

export const discordWebhookUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((value) => WEBHOOK_URL.test(value), {
    message: "Usa una URL de webhook de Discord: https://discord.com/api/webhooks/…",
  });

export type AlertSeverity = "critical" | "high";

export interface AlertFinding {
  severity: AlertSeverity;
  secretType: string;
  maskedValue: string;
  /** Primera ubicación conocida en el escaneo (si la hay). */
  filePath: string | null;
  lineNumber: number | null;
  reopened: boolean;
}

export interface AlertContext {
  projectName: string;
  scanId: string;
  /** Enlace al escaneo en LEAT (opcional). */
  scanUrl: string | null;
  findings: readonly AlertFinding[];
  timestamp: Date;
}

/** Colores de la identidad de LEAT: coral para Crítica, ámbar para Alta. */
export const SEVERITY_COLORS: Record<AlertSeverity, number> = {
  critical: 0xff5a5f,
  high: 0xf5a524,
};

const SEVERITY_LABELS: Record<AlertSeverity, string> = { critical: "Crítica", high: "Alta" };

/** Máximo de hallazgos listados en el embed; el resto se resume. */
export const MAX_LISTED_FINDINGS = 10;

/** Texto seguro dentro de código en línea: sin backticks ni saltos de línea, acotado. */
function inlineCode(value: string, max = 80): string {
  const clean = value.replace(/[`\r\n]/g, "'").slice(0, max);
  return `\`${clean}\``;
}

/** Payload JSON para el webhook (un embed por escaneo). */
export function buildAlertPayload(context: AlertContext): Record<string, unknown> {
  const sorted = [...context.findings].sort(
    (a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1),
  );
  const critical = sorted.filter((f) => f.severity === "critical").length;
  const high = sorted.length - critical;
  const topSeverity: AlertSeverity = critical > 0 ? "critical" : "high";

  const lines = sorted.slice(0, MAX_LISTED_FINDINGS).map((f) => {
    const where = f.filePath ? ` en ${inlineCode(f.filePath)}${f.lineNumber ? `:${f.lineNumber}` : ""}` : "";
    const state = f.reopened ? " (reabierto)" : "";
    return `**${SEVERITY_LABELS[f.severity]}** · ${inlineCode(f.secretType, 40)} ${inlineCode(f.maskedValue, 32)}${where}${state}`;
  });
  if (sorted.length > MAX_LISTED_FINDINGS) {
    lines.push(`… y ${sorted.length - MAX_LISTED_FINDINGS} más.`);
  }

  return {
    username: "LEAT",
    // Nunca notificar a @everyone, roles o usuarios aunque el texto lo contenga.
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `Secretos expuestos en ${context.projectName.slice(0, 80)}`,
        url: context.scanUrl ?? undefined,
        description: lines.join("\n"),
        color: SEVERITY_COLORS[topSeverity],
        fields: [
          { name: "Críticas", value: String(critical), inline: true },
          { name: "Altas", value: String(high), inline: true },
        ],
        footer: { text: `LEAT · escaneo ${context.scanId.slice(0, 8)}` },
        timestamp: context.timestamp.toISOString(),
      },
    ],
  };
}

/** Payload del mensaje de prueba desde Configuración. */
export function buildTestPayload(timestamp: Date): Record<string, unknown> {
  return {
    username: "LEAT",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "Prueba de alertas de LEAT",
        description: "Si ves este mensaje, el webhook está configurado correctamente.",
        color: 0x22d3ee,
        timestamp: timestamp.toISOString(),
      },
    ],
  };
}
