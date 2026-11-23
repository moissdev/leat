import Link from "next/link";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { formatDateTime } from "@/lib/format";
import type { AlertLog } from "@/lib/reports/queries";

/** Motivos de fallo de un intento de entrega, en español. */
function describeError(error: string | null): string {
  if (!error) return "";
  if (error === "timeout") return "Tiempo de espera agotado";
  if (error === "network_error") return "Error de red";
  const http = /^http_(\d{3})$/.exec(error);
  if (http?.[1] === "404") return "Webhook inexistente (404)";
  if (http?.[1] === "429") return "Límite de Discord (429)";
  return http ? `HTTP ${http[1]}` : error;
}

/** Intentos de entrega de alertas (`alert_logs`), del más reciente al más antiguo. */
export function AlertLogTable({ logs, showScan = true }: { logs: AlertLog[]; showScan?: boolean }) {
  if (logs.length === 0) return <p className="text-sm text-fg-muted">Sin alertas enviadas.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs text-fg-subtle">
            <th className="pb-2 font-normal">Fecha</th>
            {showScan ? <th className="pb-2 font-normal">Escaneo</th> : null}
            <th className="pb-2 font-normal">Severidad</th>
            <th className="pb-2 font-normal">Intento</th>
            <th className="pb-2 font-normal">Resultado</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-t border-line">
              <td className="py-2.5 text-fg-muted">{formatDateTime(log.created_at)}</td>
              {showScan ? (
                <td className="py-2.5">
                  {log.scan_id ? (
                    <Link href={`/scans/${log.scan_id}`} className="font-mono text-xs text-accent hover:underline">
                      {log.scan_id.slice(0, 8)}
                    </Link>
                  ) : (
                    <span className="text-xs text-fg-subtle">—</span>
                  )}
                </td>
              ) : null}
              <td className="py-2.5">
                <SeverityBadge severity={log.severity} />
              </td>
              <td className="py-2.5 text-fg-muted tabular-nums">{log.attempt}</td>
              <td className="py-2.5">
                {log.success ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-resolved-fg">
                    <span aria-hidden="true" className="size-2 rounded-full bg-status-resolved" />
                    Entregada
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-active-fg">
                    <span aria-hidden="true" className="size-2 rounded-full bg-status-active" />
                    Fallida{log.error ? ` · ${describeError(log.error)}` : ""}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
