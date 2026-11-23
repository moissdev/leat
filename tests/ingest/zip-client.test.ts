import { randomBytes } from "node:crypto";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { ZIP_LIMITS } from "@/lib/config";
import {
  buildBatches,
  DEFAULT_INGEST_LIMITS,
  normalizeEntryPath,
  prepareZipBatches,
  ZipRejectedError,
  type IngestFile,
} from "@/lib/ingest/zip-client";

const MB = 1024 * 1024;

/** Crea un ZIP en memoria con DEFLATE. */
async function makeZip(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Sobrescribe los tamaños descomprimidos declarados (cabecera local y directorio central). */
function forgeUncompressedSize(zip: Uint8Array, fakeSize: number): Uint8Array {
  const bytes = zip.slice();
  const view = new DataView(bytes.buffer);
  for (let i = 0; i + 4 <= bytes.length; i += 1) {
    const signature = view.getUint32(i, true);
    if (signature === 0x04034b50) view.setUint32(i + 22, fakeSize, true); // local header
    if (signature === 0x02014b50) view.setUint32(i + 24, fakeSize, true); // central directory
  }
  return bytes;
}

async function expectRejected(data: Uint8Array, code: string): Promise<void> {
  await expect(prepareZipBatches(data)).rejects.toSatisfy(
    (error: unknown) => error instanceof ZipRejectedError && error.code === code,
  );
}

describe("normalizeEntryPath", () => {
  it.each([
    ["src/a.ts", "src/a.ts"],
    ["./src/a.ts", "src/a.ts"],
    ["src\\win\\a.ts", "src/win/a.ts"],
    ["a//b.ts", "a/b.ts"],
  ])("normaliza %j", (raw, expected) => {
    expect(normalizeEntryPath(raw)).toBe(expected);
  });

  it.each([
    "../evil.sh",
    "src/../../evil.sh",
    "..\\evil.sh",
    "/etc/passwd",
    "\\\\server\\share\\x",
    "C:/Windows/x",
    "c:\\x",
    "a\u0000b",
    "",
    "a/".repeat(600),
  ])("rechaza %j", (raw) => {
    expect(normalizeEntryPath(raw)).toBeNull();
  });
});

describe("prepareZipBatches: zip slip", () => {
  it.each(["../evil.txt", "a/../../evil.txt", "/etc/passwd", "C:/evil.txt"])(
    "rechaza el ZIP completo con la entrada %j",
    async (name) => {
      await expectRejected(await makeZip({ "ok.ts": "const a = 1;", [name]: "x" }), "unsafe_path");
    },
  );

  it("rechaza un archivo que no es ZIP", async () => {
    await expectRejected(new TextEncoder().encode("no soy un zip"), "invalid_zip");
  });
});

describe("prepareZipBatches: filtros", () => {
  it("incluye código y omite rutas ignoradas, binarios y archivos con byte nulo", async () => {
    const zip = await makeZip({
      "src/index.ts": "export const a = 1;",
      "README.md": "# Hola",
      "node_modules/pkg/index.js": "module.exports = 1;",
      "package-lock.json": "{}",
      "public/logo.png": randomBytes(100),
      "data/blob.txt": new Uint8Array([72, 0, 73]),
      "dist/app.min.js": "x",
    });
    const { batches, stats } = await prepareZipBatches(zip);
    const paths = batches.flatMap((b) => b.files.map((f) => f.path)).sort();
    expect(paths).toEqual(["README.md", "src/index.ts"]);
    expect(stats).toEqual({
      filesTotal: 7,
      filesIncluded: 2,
      filesSkipped: 5,
      filesTruncated: 0,
      isFullScan: true,
    });
  });

  it("decodifica UTF-8", async () => {
    const { batches } = await prepareZipBatches(await makeZip({ "a.txt": "contraseña ñandú 🔑" }));
    expect(batches[0]?.files[0]?.content).toBe("contraseña ñandú 🔑");
  });
});

describe("prepareZipBatches: zip bomb y límites", () => {
  it("omite una entrada con relación de compresión anómala sin fallar", async () => {
    const zip = await makeZip({ "bomb.txt": "0".repeat(5 * MB), "ok.ts": "const a = 1;" });
    const { batches, stats } = await prepareZipBatches(zip);
    expect(batches.flatMap((b) => b.files.map((f) => f.path))).toEqual(["ok.ts"]);
    expect(stats.filesTruncated).toBe(1);
    expect(stats.isFullScan).toBe(false);
  });

  it("no confía en el tamaño declarado: corta en streaming si la cabecera miente", async () => {
    const forged = forgeUncompressedSize(await makeZip({ "liar.txt": "0".repeat(20 * MB) }), 100);
    const startedAt = performance.now();
    const { batches, stats } = await prepareZipBatches(forged);
    expect(performance.now() - startedAt).toBeLessThan(5000);
    expect(batches).toEqual([]);
    expect(stats.filesTruncated).toBe(1);
    expect(stats.isFullScan).toBe(false);
  });

  it("detiene la descompresión al agotar el presupuesto total", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`f${i}.txt`, randomBytes(30_000).toString("base64")]),
    );
    const limits = { ...DEFAULT_INGEST_LIMITS, maxUncompressedBytes: 200_000 };
    const { stats } = await prepareZipBatches(await makeZip(files), limits);
    // Cada archivo ocupa 40,000 bytes: caben exactamente 5 en 200,000.
    expect(stats.filesIncluded).toBe(5);
    expect(stats.filesTruncated).toBe(5);
    expect(stats.isFullScan).toBe(false);
  });

  it("omite archivos mayores al límite por archivo", async () => {
    const big = randomBytes(800_000).toString("base64"); // ~1.07 MB, poco compresible
    const { stats } = await prepareZipBatches(await makeZip({ "big.txt": big, "ok.ts": "1" }));
    expect(stats.filesIncluded).toBe(1);
    expect(stats.filesTruncated).toBe(1);
  });

  it("respeta el máximo de archivos por escaneo", async () => {
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}.ts`, `const v${i} = ${i};`]));
    const { stats } = await prepareZipBatches(await makeZip(files), { ...DEFAULT_INGEST_LIMITS, maxFiles: 10 });
    expect(stats.filesIncluded).toBe(10);
    expect(stats.filesTruncated).toBe(2);
    expect(stats.isFullScan).toBe(false);
  });

  it("respeta el texto máximo por escaneo", async () => {
    const files = { "a.txt": "a".repeat(600), "b.txt": "b".repeat(600) };
    const { stats } = await prepareZipBatches(await makeZip(files), {
      ...DEFAULT_INGEST_LIMITS,
      maxTextBytes: 1000,
      maxCompressionRatio: Number.POSITIVE_INFINITY,
    });
    expect(stats.filesIncluded).toBe(1);
    expect(stats.filesTruncated).toBe(1);
  });

  it("rechaza un ZIP con demasiadas entradas", async () => {
    const files = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.ts`, "1"]));
    await expect(
      prepareZipBatches(await makeZip(files), { ...DEFAULT_INGEST_LIMITS, maxEntries: 5 }),
    ).rejects.toBeInstanceOf(ZipRejectedError);
  });
});

describe("buildBatches", () => {
  const file = (path: string, size: number): IngestFile => ({ path, content: "x".repeat(size) });

  it("ningún lote supera 3 MB en su body JSON real", () => {
    const files = Array.from({ length: 40 }, (_, i) => file(`f${i}.txt`, 400_000));
    const { batches, oversized } = buildBatches(files);
    expect(oversized).toBe(0);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      const body = JSON.stringify({ chunk_index: batch.chunkIndex, files: batch.files });
      expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(ZIP_LIMITS.maxChunkBytes);
    }
  });

  it("numera los lotes de forma consecutiva desde 0 y conserva todos los archivos", () => {
    const files = Array.from({ length: 25 }, (_, i) => file(`f${i}.txt`, 300_000));
    const { batches } = buildBatches(files);
    expect(batches.map((b) => b.chunkIndex)).toEqual(batches.map((_, i) => i));
    expect(batches.flatMap((b) => b.files)).toEqual(files);
  });

  it("mide el tamaño serializado: el escape JSON cuenta", () => {
    // Cada carácter de control se serializa como \u0001 (6 bytes).
    const nasty: IngestFile = { path: "ctl.txt", content: "\u0001".repeat(600_000) };
    const { batches, oversized } = buildBatches([nasty]);
    expect(batches).toEqual([]);
    expect(oversized).toBe(1);
  });

  it("los archivos que no caben solos se cuentan como truncados en la ingesta", async () => {
    const limits = { ...DEFAULT_INGEST_LIMITS, maxChunkBytes: 500 };
    const { stats } = await prepareZipBatches(
      await makeZip({ "small.ts": "1", "large.txt": randomBytes(600).toString("hex") }),
      limits,
    );
    expect(stats.filesIncluded).toBe(1);
    expect(stats.filesTruncated).toBe(1);
  });
});
