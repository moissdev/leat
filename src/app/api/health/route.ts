import { connection, NextResponse } from "next/server";
import { buildHealthPayload } from "@/lib/health";

/**
 * Verificación de vida del despliegue. Pública, sin acceso a la base de datos
 * ni a variables secretas; solo informa el commit desplegado.
 */
export async function GET() {
  // Fuerza render dinámico: la respuesta no debe prerenderizarse ni cachearse.
  await connection();
  const payload = buildHealthPayload(process.env.VERCEL_GIT_COMMIT_SHA, new Date());
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
