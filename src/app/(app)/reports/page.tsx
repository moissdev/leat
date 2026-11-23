import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Informes · LEAT" };

export default function Page() {
  return <ComingSoon title="Informes" description="Historial de escaneos, tiempos de remediación y entregas de alertas." checkpoint={18} />;
}
