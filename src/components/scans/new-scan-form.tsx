"use client";

import { Code2, FileArchive, FileText, GitBranch, Loader2, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import { ScanClientError, startScan, type ScanProgressUpdate, type ScanSource } from "@/lib/ingest/orchestrator";

export interface ProjectOption {
  id: string;
  name: string;
  repoUrl: string | null;
}

type Mode = ScanSource["mode"];

const MODES: { mode: Mode; label: string; icon: LucideIcon; help: string }[] = [
  { mode: "snippet", label: "Fragmento", icon: Code2, help: "Pega código directamente (hasta 1 MB)." },
  { mode: "file", label: "Archivo", icon: FileText, help: "Un archivo de texto o código (hasta 1 MB)." },
  { mode: "zip", label: "ZIP", icon: FileArchive, help: "Un proyecto comprimido. Se descomprime en tu navegador." },
  { mode: "github", label: "GitHub", icon: GitBranch, help: "Un repositorio público. Lo analiza el servidor." },
];

const PHASE_LABELS: Record<ScanProgressUpdate["phase"], string> = {
  preparing: "Preparando archivos…",
  uploading: "Enviando lotes…",
  finalizing: "Finalizando…",
};

const fieldClasses =
  "w-full rounded-lg border border-line bg-raised px-3 text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none";

export function NewScanForm({ projects, defaultProjectId }: { projects: ProjectOption[]; defaultProjectId?: string }) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? "");
  const [mode, setMode] = useState<Mode>("snippet");
  const [snippet, setSnippet] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [repoUrl, setRepoUrl] = useState(projects.find((p) => p.id === projectId)?.repoUrl ?? "");
  const [progress, setProgress] = useState<ScanProgressUpdate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = progress !== null;

  function selectProject(id: string) {
    setProjectId(id);
    const repo = projects.find((p) => p.id === id)?.repoUrl;
    if (repo) setRepoUrl(repo);
  }

  async function buildSource(): Promise<ScanSource | string> {
    switch (mode) {
      case "snippet":
        return { mode, content: snippet };
      case "file":
      case "zip":
        if (!file) return "Elige un archivo.";
        return mode === "file"
          ? { mode, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
          : { mode, name: file.name, data: file };
      case "github":
        return repoUrl.trim() ? { mode, repoUrl: repoUrl.trim() } : "Escribe la URL del repositorio.";
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!projectId) return setError("Elige un proyecto.");

    const source = await buildSource();
    if (typeof source === "string") return setError(source);

    setProgress({ phase: "preparing", chunksSent: 0, chunksTotal: 0 });
    try {
      const scanId = await startScan(
        { fetch: (...args) => fetch(...args), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), onProgress: setProgress },
        projectId,
        source,
      );
      router.push(`/scans/${scanId}`);
    } catch (err) {
      setProgress(null);
      setError(err instanceof ScanClientError ? err.message : "Ocurrió un error inesperado. Intenta de nuevo.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="project" className="text-sm font-medium text-fg">
          Proyecto
        </label>
        <select
          id="project"
          value={projectId}
          onChange={(e) => selectProject(e.target.value)}
          disabled={running}
          className={cn(fieldClasses, "h-10")}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="flex flex-col gap-2" disabled={running}>
        <legend className="mb-1.5 text-sm font-medium text-fg">Origen del código</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {MODES.map(({ mode: m, label, icon: Icon }) => (
            <label
              key={m}
              className={cn(
                "flex cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                mode === m
                  ? "border-accent bg-selected font-medium text-accent"
                  : "border-line bg-raised text-fg-muted hover:border-line-strong hover:text-fg",
              )}
            >
              <input
                type="radio"
                name="mode"
                value={m}
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  setFile(null);
                }}
                className="sr-only"
              />
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </label>
          ))}
        </div>
        <p className="text-xs text-fg-subtle">{MODES.find((m) => m.mode === mode)?.help}</p>
      </fieldset>

      {mode === "snippet" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="snippet" className="text-sm font-medium text-fg">
            Código
          </label>
          <textarea
            id="snippet"
            value={snippet}
            onChange={(e) => setSnippet(e.target.value)}
            disabled={running}
            rows={12}
            spellCheck={false}
            placeholder={"const config = {\n  apiKey: process.env.API_KEY,\n};"}
            className={cn(fieldClasses, "py-2 font-mono text-xs")}
          />
        </div>
      ) : null}

      {mode === "file" || mode === "zip" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="upload" className="text-sm font-medium text-fg">
            {mode === "zip" ? "Archivo ZIP" : "Archivo"}
          </label>
          <input
            key={mode}
            id="upload"
            type="file"
            accept={mode === "zip" ? ".zip,application/zip" : undefined}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={running}
            className={cn(
              fieldClasses,
              "h-auto py-2 file:mr-3 file:rounded-md file:border-0 file:bg-selected file:px-3 file:py-1.5 file:text-sm file:text-fg",
            )}
          />
          <p className="text-xs text-fg-subtle">El código se analiza en memoria y no se guarda.</p>
        </div>
      ) : null}

      {mode === "github" ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="repo" className="text-sm font-medium text-fg">
            Repositorio público
          </label>
          <input
            id="repo"
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            disabled={running}
            placeholder="https://github.com/usuario/repositorio"
            className={cn(fieldClasses, "h-10")}
          />
          <p className="text-xs text-fg-subtle">Se analiza la rama por defecto en su último commit.</p>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={running}>
          {running ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {running ? "Escaneando…" : "Iniciar escaneo"}
        </Button>
        {progress ? (
          <p role="status" className="text-sm text-fg-muted">
            {PHASE_LABELS[progress.phase]}
            {progress.phase === "uploading" && progress.chunksTotal > 0
              ? ` ${progress.chunksSent}/${progress.chunksTotal}`
              : ""}
          </p>
        ) : null}
      </div>
    </form>
  );
}
