"use client";

import { TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Error inesperado dentro de la aplicación. Nunca muestra `error.message`
 * (podría tener detalles internos): solo el identificador para soporte.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <TriangleAlert className="size-10 text-threat-fg" aria-hidden="true" />
      <h1 className="text-xl font-semibold text-fg">Algo salió mal</h1>
      <p className="text-sm text-fg-muted">No pudimos cargar esta sección. Intenta de nuevo; si sigue fallando, vuelve más tarde.</p>
      {error.digest ? <p className="font-mono text-xs text-fg-subtle">Referencia: {error.digest}</p> : null}
      <div className="mt-2 flex gap-2">
        <Button variant="primary" onClick={reset}>
          Reintentar
        </Button>
        <ButtonLink href="/dashboard" variant="secondary">
          Ir al dashboard
        </ButtonLink>
      </div>
    </section>
  );
}
