import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Configuración · LEAT" };

export default function Page() {
  return <ComingSoon title="Configuración" description="Alertas a Discord y preferencias." checkpoint={19} />;
}
