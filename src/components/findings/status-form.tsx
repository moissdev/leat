"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/text-field";
import { updateFindingStatus, type StatusFormState } from "@/lib/findings/actions";
import { FINDING_STATUS_LABELS, type FindingStatus } from "@/lib/i18n/labels";

const STATUS_HELP: Record<FindingStatus, string> = {
  active: "El secreto sigue expuesto y requiere atención.",
  resolved: "Lo rotaste o eliminaste. Si vuelve a aparecer, se reabre solo.",
  ignored: "Riesgo aceptado. No se reabre automáticamente.",
  false_positive: "No es un secreto real. No se reabre automáticamente.",
};

const fieldClasses =
  "w-full rounded-lg border border-line bg-raised px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none";

/** Cambio de estado con nota; la transición queda en el log de auditoría. */
export function StatusForm({ findingId, current }: { findingId: string; current: FindingStatus }) {
  const [state, formAction, pending] = useActionState<StatusFormState, FormData>(updateFindingStatus, {});

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="id" value={findingId} />
      {state.error ? <FormMessage kind="error">{state.error}</FormMessage> : null}
      {state.saved ? <FormMessage kind="success">Estado actualizado</FormMessage> : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-fg">Estado</legend>
        {(Object.keys(FINDING_STATUS_LABELS) as FindingStatus[]).map((status) => (
          <label
            key={status}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-raised px-3 py-2 has-[:checked]:border-accent has-[:checked]:bg-selected"
          >
            <input type="radio" name="status" value={status} defaultChecked={status === current} className="mt-1 accent-cyan-400" />
            <span>
              <span className="block text-sm text-fg">{FINDING_STATUS_LABELS[status]}</span>
              <span className="block text-xs text-fg-subtle">{STATUS_HELP[status]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="note" className="text-sm font-medium text-fg">
          Nota (opcional)
        </label>
        <textarea
          id="note"
          name="note"
          rows={3}
          maxLength={500}
          placeholder="Rotada en AWS y eliminada del historial"
          aria-invalid={state.noteError ? true : undefined}
          aria-describedby={state.noteError ? "note-error" : "note-hint"}
          className={`${fieldClasses} py-2`}
        />
        {state.noteError ? (
          <p id="note-error" className="text-xs text-threat-fg">
            {state.noteError}
          </p>
        ) : (
          <p id="note-hint" className="text-xs text-fg-subtle">
            Queda como motivo en el historial. No escribas el secreto aquí.
          </p>
        )}
      </div>

      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Guardando…" : "Guardar estado"}
        </Button>
      </div>
    </form>
  );
}
