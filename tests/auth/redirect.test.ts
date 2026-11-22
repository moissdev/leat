import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_LOGIN, safeNextPath } from "@/lib/auth/redirect";

describe("safeNextPath (prevención de redirección abierta)", () => {
  it.each([
    ["/projects", "/projects"],
    ["/findings?status=active", "/findings?status=active"],
    ["/scans/123#detalle", "/scans/123"],
    ["/dashboard/../settings", "/settings"],
  ])("acepta la ruta interna %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ["nulo", null],
    ["vacío", ""],
    ["URL absoluta", "https://evil.example/phish"],
    ["protocol-relative", "//evil.example"],
    ["barra invertida", "/\\evil.example"],
    ["barra invertida codificada tras normalizar", "\\\\evil.example"],
    ["esquema javascript", "javascript:alert(1)"],
    ["sin barra inicial", "dashboard"],
    ["carácter de control", "/dash\nboard"],
    ["tabulador antes de //", "/\t/evil.example"],
    ["demasiado largo", `/${"a".repeat(600)}`],
  ])("rechaza %s", (_label, input) => {
    expect(safeNextPath(input)).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("usa el fallback indicado", () => {
    expect(safeNextPath("//evil.example", "/login")).toBe("/login");
  });
});
