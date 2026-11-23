"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** Monaco solo en el cliente (`ssr: false`), como pide CLAUDE.md. */
const MonacoViewer = dynamic(() => import("./monaco-viewer"), {
  ssr: false,
  loading: () => <p className="p-3 text-xs text-fg-muted">Cargando visor…</p>,
});

export interface InspectorOccurrence {
  id: string;
  scanId: string;
  filePath: string;
  lineNumber: number;
  maskedContext: string;
  when: string;
}

/** Lista de ocurrencias y visor del contexto (ya censurado) de la seleccionada. */
export function OccurrenceInspector({
  occurrences,
  maskedValue,
}: {
  occurrences: InspectorOccurrence[];
  maskedValue: string;
}) {
  const [selectedId, setSelectedId] = useState(occurrences[0]?.id);
  const selected = occurrences.find((o) => o.id === selectedId) ?? occurrences[0];
  if (!selected) return <p className="text-sm text-fg-muted">Sin ocurrencias registradas.</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto" aria-label="Ocurrencias">
        {occurrences.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => setSelectedId(o.id)}
              aria-pressed={o.id === selected.id}
              className={cn(
                "w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                o.id === selected.id
                  ? "border-accent bg-selected text-fg"
                  : "border-line bg-raised text-fg-muted hover:border-line-strong hover:text-fg",
              )}
            >
              <span className="block truncate font-mono">
                {o.filePath}:{o.lineNumber}
              </span>
              <span className="text-fg-subtle">{o.when}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="truncate font-mono text-fg-muted">{selected.filePath}</span>
          <Link href={`/scans/${selected.scanId}`} className="text-accent hover:underline">
            Ver escaneo
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-line">
          <MonacoViewer
            key={selected.id}
            path={selected.filePath}
            lineNumber={selected.lineNumber}
            maskedContext={selected.maskedContext}
            maskedValue={maskedValue}
          />
        </div>
        <p className="text-xs text-fg-subtle">
          Contexto de la línea con todos los secretos censurados. LEAT no guarda el código original.
        </p>
      </div>
    </div>
  );
}
