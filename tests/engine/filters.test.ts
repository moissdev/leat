import { describe, expect, it } from "vitest";
import { SCAN_LIMITS } from "@/lib/config";
import {
  getSkipReason,
  hasBinaryExtension,
  hasNullByte,
  isIgnoredPath,
  utf8ByteLength,
} from "@/lib/engine";

describe("isIgnoredPath", () => {
  it.each([
    "node_modules/lodash/index.js",
    "apps/web/node_modules/x/y.js",
    ".git/config",
    "dist/main.js",
    "build/output.js",
    ".next/server/app.js",
    "vendor/autoload.php",
    "src/__pycache__/mod.cpython-312.pyc",
    "package-lock.json",
    "frontend/yarn.lock",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "public/app.min.js",
    "public/styles.min.css",
    "public/app.js.map",
    "node_modules\\pkg\\index.js", // separadores de Windows
    "./dist/bundle.js",
  ])("ignora %s", (path) => {
    expect(isIgnoredPath(path)).toBe(true);
  });

  it.each([
    "src/index.ts",
    "src/build-utils.ts", // "build" como parte del nombre, no directorio
    "docs/distribution.md",
    "config/.env.example",
    "src/vendors.ts",
    "package.json",
    "app.mini.js",
  ])("analiza %s", (path) => {
    expect(isIgnoredPath(path)).toBe(false);
  });

  it("solo ignora directorios, no un archivo llamado igual", () => {
    expect(isIgnoredPath("scripts/build")).toBe(false);
  });
});

describe("binarios", () => {
  it.each(["logo.png", "fonts/Inter.woff2", "a/b/photo.JPG", "app.exe", "data.sqlite", "doc.pdf"])(
    "%s tiene extensión binaria",
    (path) => {
      expect(hasBinaryExtension(path)).toBe(true);
    },
  );

  it.each(["src/app.ts", "README", ".png", "image.png.ts"])("%s no tiene extensión binaria", (path) => {
    expect(hasBinaryExtension(path)).toBe(false);
  });

  it("detecta un byte nulo solo dentro de la ventana inicial", () => {
    expect(hasNullByte(new Uint8Array([72, 0, 73]))).toBe(true);
    expect(hasNullByte(new Uint8Array([72, 73]))).toBe(false);
    const late = new Uint8Array(SCAN_LIMITS.binarySniffBytes + 10).fill(65);
    late[SCAN_LIMITS.binarySniffBytes + 5] = 0;
    expect(hasNullByte(late)).toBe(false);
  });
});

describe("utf8ByteLength", () => {
  it.each(["", "abc", "ñandú", "€", "🔑 clave", "日本語"])("coincide con TextEncoder para %j", (text) => {
    expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).length);
  });
});

describe("getSkipReason", () => {
  it("analiza un archivo de código normal", () => {
    expect(getSkipReason({ path: "src/a.ts", content: "const a = 1;" })).toBeNull();
  });

  it("clasifica rutas ignoradas, binarios y archivos grandes", () => {
    expect(getSkipReason({ path: "node_modules/a.js", content: "" })).toBe("ignored_path");
    expect(getSkipReason({ path: "logo.png", content: "" })).toBe("binary");
    expect(getSkipReason({ path: "data.txt", content: "abc\u0000def" })).toBe("binary");
    const big = "a".repeat(SCAN_LIMITS.maxFileBytes + 1);
    expect(getSkipReason({ path: "big.txt", content: big })).toBe("too_large");
  });

  it("el límite de tamaño se mide en bytes UTF-8, no en caracteres", () => {
    // Cada "ñ" ocupa 2 bytes: la mitad de caracteres ya excede el límite.
    const content = "ñ".repeat(SCAN_LIMITS.maxFileBytes / 2 + 1);
    expect(getSkipReason({ path: "a.txt", content })).toBe("too_large");
  });
});
