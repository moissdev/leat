import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Hallazgos · LEAT" };

export default function Page() {
  return <ComingSoon title="Hallazgos" description="Secretos detectados en tus proyectos y su estado." checkpoint={17} />;
}
