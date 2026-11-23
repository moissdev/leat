import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Proyectos · LEAT" };

export default function Page() {
  return <ComingSoon title="Proyectos" description="Agrupa tus escaneos por proyecto." checkpoint={15} />;
}
