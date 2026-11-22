import { describe, expect, it } from "vitest";
import { buildHealthPayload } from "@/lib/health";

const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("buildHealthPayload", () => {
  it("devuelve estado ok y la hora en ISO", () => {
    expect(buildHealthPayload(undefined, NOW)).toEqual({
      status: "ok",
      commit: null,
      timestamp: "2026-01-01T00:00:00.000Z",
    });
  });

  it("recorta el SHA del commit a 7 caracteres", () => {
    const sha = "ABCDEF0123456789abcdef0123456789abcdef01";
    expect(buildHealthPayload(sha, NOW).commit).toBe("abcdef0");
  });

  it("descarta valores que no son un SHA hexadecimal", () => {
    expect(buildHealthPayload("<script>", NOW).commit).toBeNull();
    expect(buildHealthPayload("", NOW).commit).toBeNull();
  });

  it("no expone más claves que las previstas", () => {
    expect(Object.keys(buildHealthPayload("abcdef0", NOW)).sort()).toEqual([
      "commit",
      "status",
      "timestamp",
    ]);
  });
});
