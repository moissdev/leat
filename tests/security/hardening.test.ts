import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { SCAN_LIMITS } from "@/lib/config";
import { getSkipReason, scanFile } from "@/lib/engine";
import { prepareZipBatches } from "@/lib/ingest/zip-client";

/**
 * Endurecimiento (checkpoint 21): ReDoS con entradas aleatorias, zip bomb
 * anidado, ausencia de contenido o secretos en los logs del código y
 * escaneo del propio repositorio de LEAT.
 */

const PEPPER = "p".repeat(64);

describe("ReDoS: fuzzing del motor completo", () => {
  /** Alfabeto con los caracteres que usan las regex del catálogo. */
  const ALPHABET = "AKIASIAsk_live_rk_ghp_github_pat_xoxb-AIzaSG.eyJ-----BEGIN PRIVATE KEY:/@=\"' 0123456789abcdef+_.";

  function randomLine(length: number, seed: Buffer): string {
    let line = "";
    for (let i = 0; i < length; i += 1) line += ALPHABET[(seed[i % seed.length] ?? 0) % ALPHABET.length];
    return line;
  }

  it("300 líneas aleatorias de 2,000 caracteres se analizan en menos de 3 s", () => {
    const lines = Array.from({ length: 300 }, () => randomLine(SCAN_LIMITS.maxLineLength, randomBytes(4096)));
    const startedAt = performance.now();
    scanFile({ path: "fuzz.txt", content: lines.join("\n") }, { pepper: PEPPER });
    expect(performance.now() - startedAt).toBeLessThan(3000);
  });

  it("ninguna línea aislada tarda más de 50 ms", () => {
    for (let i = 0; i < 200; i += 1) {
      const line = randomLine(SCAN_LIMITS.maxLineLength, randomBytes(4096));
      const startedAt = performance.now();
      scanFile({ path: "fuzz.txt", content: line }, { pepper: PEPPER });
      expect(performance.now() - startedAt).toBeLessThan(50);
    }
  });
});

describe("zip bomb", () => {
  it("un ZIP dentro de otro no se expande (los .zip internos son binarios)", async () => {
    const inner = new JSZip();
    inner.file("bomba.txt", "0".repeat(5 * 1024 * 1024));
    const innerBytes = await inner.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const outer = new JSZip();
    outer.file("capa1.zip", innerBytes);
    outer.file("ok.ts", "export const a = 1;");
    const data = await outer.generateAsync({ type: "uint8array", compression: "DEFLATE" });

    const { batches, stats } = await prepareZipBatches(data);
    expect(batches.flatMap((b) => b.files.map((f) => f.path))).toEqual(["ok.ts"]);
    expect(stats).toMatchObject({ filesTotal: 2, filesSkipped: 1, filesIncluded: 1 });
  });

  it("muchas entradas muy comprimidas se omiten sin descomprimirlas por completo", async () => {
    const zip = new JSZip();
    for (let i = 0; i < 30; i += 1) zip.file(`f${i}.txt`, "A".repeat(2 * 1024 * 1024));
    const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const startedAt = performance.now();
    const { stats } = await prepareZipBatches(data);
    expect(performance.now() - startedAt).toBeLessThan(5000);
    expect(stats.filesIncluded).toBe(0);
    expect(stats.filesTruncated).toBe(30);
    expect(stats.isFullScan).toBe(false);
  });
});

describe("logs del código: sin contenido de archivos ni secretos", () => {
  /** Únicos lugares autorizados a escribir en consola, y qué registran. */
  const ALLOWED: Record<string, RegExp> = {
    "src/lib/api/http.ts": /console\.error\(`\[\$\{route\}\] error interno`, details\)/,
    "src/lib/alerts/dispatch.ts": /console\.error\("\[alerts\] error interno", \{ name: /,
    "src/lib/ingest/github.ts": /console\.error\("\[github\] error interno", \{ name: /,
  };

  const sources = execSync("git ls-files src", { encoding: "utf8" })
    .split("\n")
    .filter((p) => /\.(ts|tsx)$/.test(p));

  it("solo los módulos autorizados usan console, y solo con nombre o código del error", () => {
    const offenders: string[] = [];
    for (const path of sources) {
      const text = readFileSync(path, "utf8");
      const calls = text.match(/console\.\w+\([^\n]*/g) ?? [];
      if (calls.length === 0) continue;
      const allowed = ALLOWED[path];
      if (!allowed || !calls.every((call) => allowed.test(call))) offenders.push(`${path}: ${calls.join(" | ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("logInternalError registra nombre, código y operación, nunca el mensaje del error", () => {
    const http = readFileSync("src/lib/api/http.ts", "utf8");
    const body = http.slice(http.indexOf("export function logInternalError"));
    expect(body).not.toMatch(/error\.message|error\.stack|String\(error\)/);
  });

  it("no hay dangerouslySetInnerHTML en la interfaz", () => {
    const offenders = sources.filter((p) => readFileSync(p, "utf8").includes("dangerouslySetInnerHTML"));
    expect(offenders).toEqual([]);
  });

  it("service_role solo se usa en módulos server-only", () => {
    const offenders = sources.filter((p) => {
      const text = readFileSync(p, "utf8");
      return text.includes("SUPABASE_SERVICE_ROLE_KEY") && !text.includes('import "server-only"');
    });
    expect(offenders).toEqual([]);
  });
});

describe("LEAT escanea su propio repositorio", () => {
  it("cero hallazgos en los archivos versionados", () => {
    const files = execSync("git ls-files", { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .map((path) => ({ path, content: readFileSync(path).toString("utf8") }))
      .filter((file) => getSkipReason(file) === null);

    const findings = files.flatMap((file) =>
      scanFile(file, { pepper: PEPPER }).map((d) => `${d.secretType} ${file.path}:${d.line} ${d.maskedValue}`),
    );
    expect(files.length).toBeGreaterThan(100);
    expect(findings).toEqual([]);
  });
});
