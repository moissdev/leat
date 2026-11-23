import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/redirect";
import { emailOtpTypeSchema } from "@/lib/auth/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Destino del enlace de confirmación de correo.
 * La plantilla "Confirm signup" de Supabase debe apuntar a:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 * Funciona aunque el enlace se abra en otro navegador o dispositivo.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = emailOtpTypeSchema.safeParse(searchParams.get("type"));
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && tokenHash.length <= 512 && type.success) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type: type.data, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
  }

  redirect("/login?error=confirmation");
}
