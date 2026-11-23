import { describe, expect, it } from "vitest";
import nextConfig, { SECURITY_HEADERS } from "../../next.config";

describe("cabeceras de seguridad", () => {
  it("se aplican a todas las rutas", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toEqual([{ source: "/:path*", headers: SECURITY_HEADERS }]);
  });

  it.each([
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ])("%s: %s", (key, value) => {
    expect(SECURITY_HEADERS.find((h) => h.key === key)?.value).toBe(value);
  });

  it("la CSP impide embeber LEAT en iframes y cargar plugins", () => {
    const csp = SECURITY_HEADERS.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("no anuncia la tecnología del servidor", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
