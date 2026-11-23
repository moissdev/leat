"use client";

import { Editor, loader, type BeforeMount, type OnMount } from "@monaco-editor/react";

/**
 * Visor Monaco en SOLO LECTURA. Recibe únicamente contexto ya enmascarado:
 * el secreto en texto plano nunca llega al navegador.
 *
 * Monaco se descarga del CDN de jsDelivr en la versión fijada (la misma que
 * instala npm); solo se descarga la biblioteca, ningún dato sale hacia el CDN.
 */
loader.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.57.0/min/vs" } });

const THEME = "leat-dark";

const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0b0f14",
      "editor.foreground": "#e6edf3",
      "editorLineNumber.foreground": "#6b7785",
      "editorLineNumber.activeForeground": "#9aa7b4",
      "editor.lineHighlightBackground": "#0b0f14",
      "editorWidget.background": "#17202b",
    },
  });
};

/** Lenguaje de Monaco según la extensión (solo para el coloreado). */
function languageFor(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    py: "python",
    rb: "ruby",
    go: "go",
    java: "java",
    cs: "csharp",
    php: "php",
    yml: "yaml",
    yaml: "yaml",
    sh: "shell",
    sql: "sql",
    md: "markdown",
    xml: "xml",
    html: "html",
    css: "css",
    tf: "hcl",
    env: "ini",
    ini: "ini",
    toml: "ini",
  };
  return path.toLowerCase().endsWith(".env") || path.toLowerCase().includes(".env.") ? "ini" : (map[ext] ?? "plaintext");
}

interface Props {
  path: string;
  lineNumber: number;
  maskedContext: string;
  maskedValue: string;
}

export default function MonacoViewer({ path, lineNumber, maskedContext, maskedValue }: Props) {
  const onMount: OnMount = (editor, monaco) => {
    // Resalta las apariciones del valor enmascarado en el contexto.
    const model = editor.getModel();
    if (!model || !maskedValue) return;
    const ranges = model.findMatches(maskedValue, false, false, true, null, false);
    editor.createDecorationsCollection(
      ranges.map((m) => ({
        range: new monaco.Range(
          m.range.startLineNumber,
          m.range.startColumn,
          m.range.endLineNumber,
          m.range.endColumn,
        ),
        options: { inlineClassName: "leat-masked-secret" },
      })),
    );
  };

  return (
    <Editor
      height="120px"
      theme={THEME}
      path={`leat-readonly:${path}:${lineNumber}`}
      language={languageFor(path)}
      value={maskedContext}
      beforeMount={defineTheme}
      onMount={onMount}
      loading={<p className="p-3 text-xs text-fg-muted">Cargando visor…</p>}
      options={{
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: false },
        wordWrap: "on",
        scrollBeyondLastLine: false,
        renderLineHighlight: "none",
        contextmenu: false,
        folding: false,
        fontSize: 13,
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
        lineNumbers: (n: number) => String(lineNumber + n - 1),
        lineNumbersMinChars: 4,
        padding: { top: 12, bottom: 12 },
        scrollbar: { alwaysConsumeMouseWheel: false },
      }}
    />
  );
}
