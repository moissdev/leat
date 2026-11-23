"use client";

import "./globals.css";

/** Último recurso si falla el layout raíz. Sin detalles internos del error. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body className="flex min-h-screen items-center justify-center px-4">
        <main role="alert" className="flex max-w-md flex-col items-center gap-3 text-center">
          <p className="text-3xl font-semibold tracking-wider text-accent">LEAT</p>
          <h1 className="text-xl font-semibold text-fg">Algo salió mal</h1>
          <p className="text-sm text-fg-muted">Ocurrió un error inesperado.</p>
          {error.digest ? <p className="font-mono text-xs text-fg-subtle">Referencia: {error.digest}</p> : null}
          <button
            type="button"
            onClick={reset}
            className="mt-2 h-10 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
