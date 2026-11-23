"use client";

import { Bell, BellOff, CheckCircle2, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import { setAlertsEnabled, type ToggleAlertsState } from "@/lib/settings/actions";

type Feedback = { kind: "error" | "success"; text: string } | null;

async function callWebhookApi(method: "PUT" | "DELETE" | "POST", body?: unknown): Promise<Feedback> {
  try {
    const response = await fetch("/api/settings/webhook", {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.ok) return null;
    const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    return { kind: "error", text: json.error?.message ?? "Ocurrió un error inesperado." };
  } catch {
    return { kind: "error", text: "No hay conexión con el servidor." };
  }
}

/**
 * Webhook de Discord. La URL solo viaja del navegador al servidor al
 * guardarla; nunca se lee de vuelta (el servidor la cifra y el cliente solo
 * sabe si está configurada).
 */
export function WebhookSettings({ configured, alertsEnabled }: { configured: boolean; alertsEnabled: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState(!configured);
  const [busy, setBusy] = useState<"save" | "test" | "delete" | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [toggleState, toggleAction, toggling] = useActionState<ToggleAlertsState, FormData>(setAlertsEnabled, {});

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url.trim()) return setFeedback({ kind: "error", text: "Pega la URL del webhook." });
    setBusy("save");
    const result = await callWebhookApi("PUT", { url: url.trim() });
    setBusy(null);
    if (result) return setFeedback(result);
    setUrl(""); // no se conserva en el estado del navegador
    setEditing(false);
    setFeedback({ kind: "success", text: "Webhook guardado y cifrado." });
    router.refresh();
  }

  async function sendTest() {
    setBusy("test");
    const result = await callWebhookApi("POST");
    setBusy(null);
    setFeedback(result ?? { kind: "success", text: "Mensaje de prueba enviado. Revisa tu canal de Discord." });
  }

  async function remove() {
    if (!window.confirm("¿Eliminar el webhook? Dejarás de recibir alertas.")) return;
    setBusy("delete");
    const result = await callWebhookApi("DELETE");
    setBusy(null);
    if (result) return setFeedback(result);
    setEditing(true);
    setFeedback({ kind: "success", text: "Webhook eliminado." });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      {feedback ? <FormMessage kind={feedback.kind}>{feedback.text}</FormMessage> : null}

      {configured && !editing ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-raised px-4 py-3">
          <span className="inline-flex items-center gap-2 text-sm text-status-resolved-fg">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Webhook configurado
          </span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={sendTest} disabled={busy !== null}>
              <Send className="size-4" aria-hidden="true" />
              {busy === "test" ? "Enviando…" : "Enviar prueba"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={busy !== null}>
              Reemplazar
            </Button>
            <Button size="sm" variant="danger" onClick={remove} disabled={busy !== null}>
              <Trash2 className="size-4" aria-hidden="true" />
              Eliminar
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="webhook-url" className="text-sm font-medium text-fg">
              URL del webhook de Discord
            </label>
            <input
              id="webhook-url"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              className="h-10 rounded-lg border border-line bg-raised px-3 font-mono text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
            />
            <p className="text-xs text-fg-subtle">
              Se oculta al escribir y se guarda cifrada. Después no se puede leer de vuelta: para cambiarla, pega una nueva.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy !== null}>
              {busy === "save" ? "Guardando…" : "Guardar webhook"}
            </Button>
            {configured ? (
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy !== null}>
                Cancelar
              </Button>
            ) : null}
          </div>
        </form>
      )}

      <form action={toggleAction} className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <input type="hidden" name="enabled" value={alertsEnabled ? "false" : "true"} />
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-fg">
            {alertsEnabled ? (
              <Bell className="size-4 text-accent" aria-hidden="true" />
            ) : (
              <BellOff className="size-4 text-fg-subtle" aria-hidden="true" />
            )}
            Alertas {alertsEnabled ? "activadas" : "desactivadas"}
          </p>
          <p className="text-xs text-fg-subtle">
            {alertsEnabled
              ? "Recibirás un mensaje por escaneo con hallazgos Alta o Crítica nuevos o reabiertos."
              : "No se enviarán alertas hasta que las actives. El webhook se conserva."}
          </p>
          {toggleState.error ? <p className="mt-1 text-xs text-threat-fg">{toggleState.error}</p> : null}
        </div>
        <Button
          type="submit"
          size="sm"
          variant={alertsEnabled ? "secondary" : "primary"}
          disabled={toggling || !configured}
          className={cn(!configured && "opacity-60")}
        >
          {alertsEnabled ? "Desactivar" : "Activar"}
        </Button>
      </form>
    </div>
  );
}
