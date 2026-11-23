import { NextResponse } from "next/server";
import { utf8ByteLength } from "../engine/filters";

/**
 * Utilidades HTTP de las rutas de API. Las respuestas de error solo llevan un
 * código y un mensaje genérico: nunca contenido de archivos ni secretos.
 */

export function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export function jsonOk(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export type JsonBodyResult = { ok: true; value: unknown } | { ok: false; response: NextResponse };

/** Lee y parsea un body JSON rechazando los que exceden `maxBytes`. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  const tooLarge = () => ({
    ok: false as const,
    response: jsonError(413, "payload_too_large", "El cuerpo de la petición es demasiado grande."),
  });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();

  const text = await request.text();
  if (utf8ByteLength(text) > maxBytes) return tooLarge();

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: jsonError(400, "invalid_json", "El cuerpo no es JSON válido.") };
  }
}

/** Registra un error interno sin datos sensibles: solo nombre y, si existe, código y operación. */
export function logInternalError(route: string, error: unknown): void {
  const details =
    error instanceof Error
      ? {
          name: error.name,
          code: "code" in error ? String(error.code) : undefined,
          operation: "operation" in error ? String(error.operation) : undefined,
        }
      : { name: typeof error };
  console.error(`[${route}] error interno`, details);
}
