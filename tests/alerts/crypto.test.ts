import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, parseEncryptionKey } from "@/lib/alerts/crypto";
import { alnum } from "../fixtures/secrets";

const KEY = randomBytes(32);
const USER = "6f1c2a9e-0000-4000-8000-000000000001";
const WEBHOOK = "https://discord.com/api/webhooks/" + "123456789012345678" + "/" + alnum(68, 3);

describe("encryptSecret / decryptSecret (AES-256-GCM)", () => {
  it("ida y vuelta", () => {
    const secret = encryptSecret(WEBHOOK, KEY, USER);
    expect(decryptSecret(secret, KEY, USER)).toBe(WEBHOOK);
    expect(secret.keyVersion).toBe(1);
  });

  it("el texto cifrado no contiene la URL y cambia en cada cifrado (IV aleatorio)", () => {
    const a = encryptSecret(WEBHOOK, KEY, USER);
    const b = encryptSecret(WEBHOOK, KEY, USER);
    expect(JSON.stringify(a)).not.toContain(WEBHOOK);
    expect(JSON.stringify(a)).not.toContain(WEBHOOK.split("/").pop());
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(Buffer.from(a.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(a.tag, "base64")).toHaveLength(16);
  });

  /** Altera un byte de un campo base64. */
  const flip = (b64: string, index = 0) => {
    const bytes = Buffer.from(b64, "base64");
    bytes[index] = (bytes[index] ?? 0) ^ 0x01;
    return bytes.toString("base64");
  };

  it.each([
    ["texto cifrado", (s: ReturnType<typeof encryptSecret>) => ({ ...s, ciphertext: flip(s.ciphertext, 5) })],
    ["IV", (s: ReturnType<typeof encryptSecret>) => ({ ...s, iv: flip(s.iv) })],
    ["etiqueta", (s: ReturnType<typeof encryptSecret>) => ({ ...s, tag: flip(s.tag) })],
  ])("detecta la manipulación del %s", (_label, tamper) => {
    const secret = encryptSecret(WEBHOOK, KEY, USER);
    expect(() => decryptSecret(tamper(secret), KEY, USER)).toThrow(/alterados/);
  });

  it("no descifra con el user_id de otra fila (AAD)", () => {
    const secret = encryptSecret(WEBHOOK, KEY, USER);
    expect(() => decryptSecret(secret, KEY, "otro-usuario")).toThrow();
  });

  it("no descifra con otra clave", () => {
    const secret = encryptSecret(WEBHOOK, KEY, USER);
    expect(() => decryptSecret(secret, randomBytes(32), USER)).toThrow();
  });

  it("el error de descifrado no revela datos", () => {
    const secret = encryptSecret(WEBHOOK, KEY, USER);
    try {
      decryptSecret({ ...secret, tag: flip(secret.tag) }, KEY, USER);
    } catch (error) {
      expect(String(error)).not.toContain(WEBHOOK);
      expect(String(error)).not.toContain(secret.ciphertext);
    }
  });

  it("rechaza IV o etiqueta con longitud inválida", () => {
    const secret = encryptSecret(WEBHOOK, KEY, USER);
    expect(() => decryptSecret({ ...secret, iv: "AAAA" }, KEY, USER)).toThrow(/inválidos/);
  });

  it("exige una clave de 32 bytes", () => {
    expect(() => encryptSecret(WEBHOOK, randomBytes(16), USER)).toThrow();
  });
});

describe("parseEncryptionKey", () => {
  const raw = randomBytes(32);

  it.each([
    ["hex de 64 caracteres", raw.toString("hex")],
    ["base64", raw.toString("base64")],
    ["base64url", raw.toString("base64url")],
  ])("acepta %s", (_label, value) => {
    expect(parseEncryptionKey(value).equals(raw)).toBe(true);
  });

  it("acepta 32 caracteres ASCII literales", () => {
    const literal = alnum(32, 7);
    expect(parseEncryptionKey(literal)).toEqual(Buffer.from(literal, "ascii"));
  });

  it.each(["", "corta", alnum(31), alnum(33), randomBytes(16).toString("base64"), "x".repeat(31) + " "])(
    "rechaza %j sin revelar el valor",
    (value) => {
      try {
        parseEncryptionKey(value);
        expect.unreachable();
      } catch (error) {
        expect(String(error)).toContain("32 bytes");
        if (value.length > 4) expect(String(error)).not.toContain(value);
      }
    },
  );
});
