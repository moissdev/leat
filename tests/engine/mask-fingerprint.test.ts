import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fingerprintSecret, MIN_PEPPER_LENGTH } from "@/lib/engine/fingerprint";
import { maskLine, maskSecret } from "@/lib/engine/mask";
import { alnum, FAKE } from "../fixtures/secrets";

/** Caracteres del secreto que quedan visibles en la máscara. */
function revealedCount(masked: string): number {
  return masked.replace(/\.\.\.|\*/g, "").length;
}

/** Cadenas aleatorias de longitud 1..200 (base64url, sin `*` ni `.`). */
const randomSecrets = Array.from({ length: 300 }, (_, i) =>
  randomBytes(200).toString("base64url").slice(0, (i % 200) + 1),
);

describe("maskSecret: formato", () => {
  it("16 caracteres o más: 4 iniciales + ... + 4 finales", () => {
    const secret = FAKE.stripeLiveKey;
    expect(maskSecret(secret)).toBe(`${secret.slice(0, 4)}...${secret.slice(-4)}`);
    expect(maskSecret("a".repeat(15) + "b")).toBe("aaaa...aaab");
  });

  it("menos de 16: 2 iniciales y el resto *", () => {
    expect(maskSecret("abcdefghijklmno")).toBe("ab*************");
    expect(maskSecret("abcde")).toBe("ab***");
  });

  it("4 caracteres o menos: todo *", () => {
    expect(maskSecret("abcd")).toBe("****");
    expect(maskSecret("a")).toBe("*");
    expect(maskSecret("")).toBe("");
  });

  it("no parte caracteres fuera del BMP", () => {
    expect(maskSecret("🔑🔑🔑🔑🔑🔑")).toBe("🔑🔑****");
  });
});

describe("maskSecret: invariantes", () => {
  it("con 300 secretos aleatorios (1..200 caracteres) revela como máximo 8 y nunca el secreto completo", () => {
    for (const secret of randomSecrets) {
      const masked = maskSecret(secret);
      expect(revealedCount(masked), secret.length.toString()).toBeLessThanOrEqual(8);
      if (secret.length > 4) expect(masked).not.toContain(secret);
      // Lo visible es prefijo y sufijo del original.
      const [head = "", tail = ""] = masked.replace(/\*+$/, "").split("...");
      expect(secret.startsWith(head)).toBe(true);
      expect(secret.endsWith(tail)).toBe(true);
    }
  });

  it("es determinista", () => {
    expect(maskSecret(FAKE.githubToken)).toBe(maskSecret(FAKE.githubToken));
  });
});

describe("maskLine", () => {
  it("enmascara TODOS los secretos de la línea y deja el resto intacto", () => {
    const a = FAKE.awsAccessKey;
    const b = FAKE.githubToken;
    const text = `aws="${a}" gh="${b}" // fin`;
    const spans = [
      { start: text.indexOf(b), end: text.indexOf(b) + b.length },
      { start: text.indexOf(a), end: text.indexOf(a) + a.length },
    ];
    const masked = maskLine(text, spans);
    expect(masked).toBe(`aws="${maskSecret(a)}" gh="${maskSecret(b)}" // fin`);
    expect(masked).not.toContain(a);
    expect(masked).not.toContain(b);
  });

  it("fusiona tramos traslapados sin filtrar caracteres", () => {
    const secret = alnum(40);
    const text = `k=${secret};`;
    const masked = maskLine(text, [
      { start: 2, end: 30 },
      { start: 20, end: 42 },
    ]);
    expect(masked).toBe(`k=${maskSecret(secret)};`);
  });

  it("sin tramos devuelve la línea igual", () => {
    expect(maskLine("const a = 1;", [])).toBe("const a = 1;");
  });

  it("ignora tramos vacíos y recorta los que salen de la línea", () => {
    const text = `x=${alnum(20)}`;
    expect(maskLine(text, [{ start: 5, end: 5 }])).toBe(text);
    expect(maskLine(text, [{ start: 2, end: 999 }])).toBe(`x=${maskSecret(alnum(20))}`);
  });
});

describe("fingerprintSecret", () => {
  const PEPPER_A = alnum(64, 1);
  const PEPPER_B = alnum(64, 2);

  it("devuelve 64 caracteres hexadecimales", () => {
    expect(fingerprintSecret(FAKE.awsAccessKey, PEPPER_A)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("es determinista con el mismo secreto y pepper", () => {
    expect(fingerprintSecret(FAKE.awsAccessKey, PEPPER_A)).toBe(
      fingerprintSecret(FAKE.awsAccessKey, PEPPER_A),
    );
  });

  it("cambia con el pepper", () => {
    expect(fingerprintSecret(FAKE.awsAccessKey, PEPPER_A)).not.toBe(
      fingerprintSecret(FAKE.awsAccessKey, PEPPER_B),
    );
  });

  it("cambia con el secreto", () => {
    expect(fingerprintSecret(FAKE.awsAccessKey, PEPPER_A)).not.toBe(
      fingerprintSecret(FAKE.githubToken, PEPPER_A),
    );
  });

  it("no contiene el secreto", () => {
    const secret = "abc" + "123";
    expect(fingerprintSecret(secret, PEPPER_A)).not.toContain(secret);
  });

  it("rechaza un pepper demasiado corto sin revelar su valor", () => {
    const shortPepper = "corto" + "-pepper";
    expect(() => fingerprintSecret("x", shortPepper)).toThrow(String(MIN_PEPPER_LENGTH));
    try {
      fingerprintSecret("x", shortPepper);
    } catch (error) {
      expect(String(error)).not.toContain(shortPepper);
    }
  });
});
