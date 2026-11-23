import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard · LEAT" };

// Página provisional: el dashboard real (KPIs, score, gráficas) es el checkpoint 16.
export default function DashboardPage() {
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="text-sm opacity-70">Sesión iniciada. Aquí irá el resumen de seguridad.</p>
    </section>
  );
}
