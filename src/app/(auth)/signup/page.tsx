import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = { title: "Crear cuenta · LEAT" };

export default function SignupPage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Crear cuenta</h1>
      <SignupForm />
    </section>
  );
}
