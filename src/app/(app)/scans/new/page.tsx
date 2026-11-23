import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Nuevo escaneo · LEAT" };

export default function Page() {
  return <ComingSoon title="Nuevo escaneo" description="Analiza un fragmento, un archivo, un ZIP o un repositorio público de GitHub." checkpoint={15} />;
}
