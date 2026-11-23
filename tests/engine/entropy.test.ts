import { createHash, randomBytes, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  assignedName,
  classifyCharset,
  ENTROPY_SETTINGS,
  findEntropyMatches,
  nameWords,
  shannonEntropy,
} from "@/lib/engine/entropy";
import { alnum, hex } from "../fixtures/secrets";

/** Valor aleatorio de alta entropía (40 caracteres alfanuméricos distintos). */
const RANDOM = alnum(40, 13);

describe("shannonEntropy", () => {
  it.each([
    ["", 0],
    ["aaaaaaaa", 0],
    ["abababab", 1],
    ["0123456789abcdef", 4],
  ])("H(%j) = %d", (value, expected) => {
    expect(shannonEntropy(value)).toBeCloseTo(expected, 10);
  });
});

describe("classifyCharset", () => {
  it("distingue hexadecimal de base64/alfanumérico", () => {
    expect(classifyCharset(hex(32))).toBe("hex");
    expect(classifyCharset(hex(32).toUpperCase())).toBe("hex");
    expect(classifyCharset(RANDOM)).toBe("base64");
  });
});

describe("nameWords y assignedName", () => {
  it("separa camelCase, snake_case y kebab-case", () => {
    expect(nameWords("fileSha256")).toEqual(["file", "sha256"]);
    expect(nameWords("FILE_SHA256")).toEqual(["file", "sha256"]);
    expect(nameWords("sharedSecret")).toEqual(["shared", "secret"]);
  });

  it.each([
    ['const apiKey = "', "apiKey"],
    ['  "client_secret": "', "client_secret"],
    ["PASSWORD=", "PASSWORD"],
    ["config.authToken := '", "config.authToken"],
    ["$token => '", "$token"],
    ["console.log(", null],
  ])("nombre asignado en %j", (before, expected) => {
    expect(assignedName(before)).toBe(expected);
  });
});

describe("findEntropyMatches: positivos", () => {
  it("cadena aleatoria sin contexto → Baja", () => {
    const text = `const value = "${RANDOM}";`;
    const [match] = findEntropyMatches(text);
    expect(match?.severity).toBe("low");
    expect(match?.hasContext).toBe(false);
    expect(match?.charset).toBe("base64");
    expect(text.slice(match?.start, match?.end)).toBe(RANDOM);
  });

  it("hexadecimal aleatorio sin contexto → Baja", () => {
    const [match] = findEntropyMatches(`x = "${hex(32, 1)}"`);
    expect(match?.charset).toBe("hex");
    expect(match?.entropy).toBeGreaterThanOrEqual(ENTROPY_SETTINGS.hexThreshold);
    expect(match?.severity).toBe("low");
  });

  it.each([
    `const apiKey = "${RANDOM}";`,
    `  "client_secret": "${RANDOM}",`,
    `PASSWORD=${RANDOM}`,
    `db_pwd: ${RANDOM}`,
    `authHeader = '${RANDOM}'`,
    `sharedSecret = "${RANDOM}"`,
    `ACCESS_TOKEN=${RANDOM}==`,
  ])("el nombre con contexto sube la severidad a Media: %s", (text) => {
    const matches = findEntropyMatches(text);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.severity).toBe("medium");
    expect(matches[0]?.hasContext).toBe(true);
  });

  it("el nombre de la variable no forma parte del secreto", () => {
    const [match] = findEntropyMatches(`API_KEY=${RANDOM}`);
    expect(match?.secret).toBe(RANDOM);
  });

  it("conserva el relleno base64 final", () => {
    const [match] = findEntropyMatches(`token=${RANDOM}==`);
    expect(match?.secret).toBe(`${RANDOM}==`);
  });
});

describe("findEntropyMatches: exclusiones (no se marcan)", () => {
  it("UUIDs", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(findEntropyMatches(`const id = "${randomUUID()}";`)).toEqual([]);
    }
  });

  it("hashes de integridad de lockfiles (sha512-…)", () => {
    const integrity = "sha512-" + createHash("sha512").update("leat").digest("base64");
    expect(findEntropyMatches(`      "integrity": "${integrity}",`)).toEqual([]);
    expect(findEntropyMatches(`  integrity ${integrity}`)).toEqual([]);
  });

  it("hashes asignados a nombres de hash o commit", () => {
    const sha1 = createHash("sha1").update("leat").digest("hex");
    const sha256 = createHash("sha256").update("leat").digest("hex");
    expect(findEntropyMatches(`  resolved_sha1 = "${sha1}"`)).toEqual([]);
    expect(findEntropyMatches(`fileSha256: "${sha256}"`)).toEqual([]);
    expect(findEntropyMatches(`"commit": "${sha1}"`)).toEqual([]);
    expect(findEntropyMatches(`checksum=${sha256}`)).toEqual([]);
  });

  it("base64 de imágenes incrustadas (data:)", () => {
    const image = randomBytes(600).toString("base64");
    expect(findEntropyMatches(`<img src="data:image/png;base64,${image}" />`)).toEqual([]);
    expect(findEntropyMatches(`background: url(data:image/svg+xml;base64,${image});`)).toEqual([]);
  });

  it("cadenas por debajo de la longitud mínima", () => {
    expect(findEntropyMatches(`key = "${alnum(ENTROPY_SETTINGS.minLength - 1)}"`)).toEqual([]);
  });

  it.each([
    "const veryLongIdentifierWithoutAnyDigits = true;",
    "getUserProfileByIdentifier2Async();",
    'import { Card } from "../components/dashboard/KpiCard2";',
    "timestamp = 17953930173861234567",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
    "// ================================================",
    "name: my-very-long-css-class-name-2",
  ])("texto común de bajo riesgo: %s", (text) => {
    expect(findEntropyMatches(text)).toEqual([]);
  });
});

describe("tiempo acotado con entradas patológicas", () => {
  const MAX_LINE = 2000;
  it.each([
    ["alfabeto completo", alnum(MAX_LINE)],
    ["asignaciones repetidas", "a=".repeat(MAX_LINE / 2)],
    ["relleno", "=".repeat(MAX_LINE)],
    ["tokens cortos", `${alnum(19)} `.repeat(MAX_LINE / 20)],
  ])("%s se evalúa en menos de 50 ms", (_label, text) => {
    const startedAt = performance.now();
    findEntropyMatches(text);
    expect(performance.now() - startedAt).toBeLessThan(50);
  });
});

describe("findEntropyMatches: falsos positivos de repos reales", () => {
  const sha = createHash("sha1").update("pin").digest("hex");

  it("excluye referencias de git fijadas con @ (GitHub Actions)", () => {
    expect(findEntropyMatches(`      - uses: actions/checkout@${sha} # v4.2.0`)).toEqual([]);
  });

  it("un SHA suelto, sin @ ni nombre de hash, se sigue marcando como Baja", () => {
    expect(findEntropyMatches(`value = "${sha}"`)).toHaveLength(1);
  });

  it("excluye hex que es texto codificado o datos comprimidos (sin contexto)", () => {
    const text = Buffer.from('{"name":"tobi","ok":true}').toString("hex");
    const gzip = gzipSync(Buffer.from("hola mundo")).toString("hex");
    expect(findEntropyMatches(`test.write(Buffer.from('${text}', 'hex'))`)).toEqual([]);
    expect(findEntropyMatches(`test.write(Buffer.from('${gzip}', 'hex'))`)).toEqual([]);
  });

  it("un hex aleatorio sigue marcándose, y con contexto incluso si es texto codificado", () => {
    expect(findEntropyMatches(`x = "${randomBytes(16).toString("hex")}"`)).toHaveLength(1);
    // Texto imprimible cuyo hex supera el umbral (3.36 bits): sin contexto se
    // trata como datos; con un nombre de variable sensible se sigue reportando.
    const encoded = Buffer.from(["Zx9!Qw7#", "Lp3$Vb5%Kd"].join("")).toString("hex");
    expect(findEntropyMatches(`x = "${encoded}"`)).toEqual([]);
    expect(findEntropyMatches(`password = "${encoded}"`)[0]?.severity).toBe("medium");
  });

  it("excluye ETags del paquete etag (express, koa)", () => {
    const etag = createHash("sha1").update("express!").digest("base64").slice(0, 27);
    expect(findEntropyMatches(`.expect('ETag', 'W/"3e7-${etag}"')`)).toEqual([]);
    expect(findEntropyMatches(`'"8-${etag}"'`)).toEqual([]);
  });

  it("en la ruta de una URL evalúa cada segmento: los cortos no se marcan", () => {
    expect(findEntropyMatches("[GHSA](https://github.com/ljharb/qs/security/advisories/GHSA-w7fw-mjwx-w883)")).toEqual([]);
    expect(findEntropyMatches("see https://nvd.nist.gov/vuln/detail/CVE-2024-47764")).toEqual([]);
  });

  it("un token largo en la ruta de una URL (webhook) se sigue detectando, sin el resto de la ruta", () => {
    const token = alnum(68, 3);
    const text = `const hook = "https://discord.com/api/webhooks/123456789012345678/${token}";`;
    const [match] = findEntropyMatches(text);
    expect(match?.secret).toBe(token);
  });

  it("la query de una URL se sigue analizando completa", () => {
    const token = alnum(40, 4);
    expect(findEntropyMatches(`fetch("https://api.example.com/v1/items?access_token=${token}")`)[0]?.secret).toBe(token);
  });
});

describe("findEntropyMatches: rutas de archivo", () => {
  it.each([
    "supabase/migrations/003_scan_chunk_idempotency.sql",
    "ver src/lib/engine/scanner_v2_2026.ts",
    "import x from './node_modules_cache/abc123def456/index'",
  ])("no marca la ruta en minúsculas de %j", (text) => {
    expect(findEntropyMatches(text)).toEqual([]);
  });

  it("un secreto base64 con / (mayúsculas mezcladas) se sigue detectando", () => {
    const secret = ["wJalrXUtnFEMI", "K7MDENG", "bPxRfiCYEXAMPLEKEY"].join("/");
    expect(findEntropyMatches(`value = "${secret}"`).map((m) => m.secret)).toEqual([secret]);
  });

  it("un token en minúsculas sin / sigue evaluándose por entropía", () => {
    const token = alnum(40, 2).toLowerCase() + "9";
    expect(findEntropyMatches(`token = "${token}"`)).toHaveLength(1);
  });
});
