import { describe, expect, it } from "vitest";
import { emailOtpTypeSchema, loginSchema, signupSchema } from "@/lib/auth/schemas";

// Contraseña de prueba armada en tiempo de ejecución (no es una credencial real).
const PASSWORD = ["prueba", "Segura", "123"].join("-");

describe("loginSchema", () => {
  it("normaliza el correo (espacios y mayúsculas)", () => {
    const result = loginSchema.parse({ email: "  Usuario@Ejemplo.COM ", password: PASSWORD });
    expect(result.email).toBe("usuario@ejemplo.com");
  });

  it("rechaza correos inválidos y contraseña vacía", () => {
    expect(loginSchema.safeParse({ email: "no-es-correo", password: PASSWORD }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });

  it("rechaza contraseñas de más de 72 caracteres (límite de bcrypt)", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x".repeat(73) }).success).toBe(false);
  });
});

describe("signupSchema", () => {
  it("acepta datos válidos", () => {
    const ok = signupSchema.safeParse({
      email: "a@b.co",
      password: PASSWORD,
      confirmPassword: PASSWORD,
    });
    expect(ok.success).toBe(true);
  });

  it("exige al menos 8 caracteres", () => {
    const short = signupSchema.safeParse({ email: "a@b.co", password: "corta", confirmPassword: "corta" });
    expect(short.success).toBe(false);
  });

  it("exige que las contraseñas coincidan", () => {
    const result = signupSchema.safeParse({
      email: "a@b.co",
      password: PASSWORD,
      confirmPassword: `${PASSWORD}x`,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});

describe("emailOtpTypeSchema", () => {
  it("solo acepta los tipos de enlace de confirmación", () => {
    expect(emailOtpTypeSchema.safeParse("email").success).toBe(true);
    expect(emailOtpTypeSchema.safeParse("signup").success).toBe(true);
    expect(emailOtpTypeSchema.safeParse("recovery").success).toBe(false);
    expect(emailOtpTypeSchema.safeParse(null).success).toBe(false);
  });
});
