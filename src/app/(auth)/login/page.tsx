import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Iniciar sesión · LEAT" };

export default function LoginPage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Iniciar sesión</h1>
      {/* El formulario lee ?next y ?error de la URL: dato de request, va en Suspense. */}
      <Suspense fallback={<p className="text-sm opacity-70">Cargando…</p>}>
        <LoginForm />
      </Suspense>
    </section>
  );
}
