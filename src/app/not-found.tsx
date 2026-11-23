import Link from "next/link";

/** Ruta inexistente fuera de la aplicación autenticada. */
export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <p className="text-3xl font-semibold tracking-wider text-accent">LEAT</p>
        <h1 className="text-xl font-semibold text-fg">Página no encontrada</h1>
        <p className="text-sm text-fg-muted">La dirección no existe.</p>
        <Link href="/dashboard" className="text-sm text-accent hover:underline">
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
