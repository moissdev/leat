import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";

/** Recurso inexistente o ajeno (RLS lo oculta igual que si no existiera). */
export default function AppNotFound() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <SearchX className="size-10 text-fg-subtle" aria-hidden="true" />
      <h1 className="text-xl font-semibold text-fg">No lo encontramos</h1>
      <p className="text-sm text-fg-muted">Lo que buscas no existe o no pertenece a tu cuenta.</p>
      <ButtonLink href="/dashboard" variant="secondary" className="mt-2">
        Ir al dashboard
      </ButtonLink>
    </section>
  );
}
