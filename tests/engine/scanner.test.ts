import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SCAN_LIMITS } from "@/lib/config";
import { scanFile, type Detection } from "@/lib/engine";
import { alnum, FAKE, fakeJwt } from "../fixtures/secrets";

const PEPPER = alnum(64, 21);
const scan = (content: string, path = "src/config.ts"): Detection[] =>
  scanFile({ path, content }, { pepper: PEPPER });

/** Todos los valores secretos de los fixtures, para comprobar que no se filtran. */
const ALL_SECRETS: string[] = [
  ...Object.values(FAKE).filter((v): v is string => typeof v === "string"),
  ...FAKE.pemLines.slice(1, -1),
];

function expectNoPlaintext(value: unknown): void {
  const json = JSON.stringify(value);
  for (const secret of ALL_SECRETS) {
    expect(json.includes(secret), `se filtró un secreto de ${secret.length} caracteres`).toBe(false);
  }
}

const TRUE_POSITIVE_FILE = [
  "// Configuración con secretos filtrados (todos falsos)",
  `export const AWS_ACCESS_KEY_ID = "${FAKE.awsAccessKey}";`,
  `export const AWS_SECRET_ACCESS_KEY = "${FAKE.awsSecretKey}";`,
  `const stripe = new Stripe("${FAKE.stripeLiveKey}");`,
  `const db = "postgres://app:${FAKE.dbPassword}@db.example.com:5432/leat";`,
  `const supabaseAdmin = createClient(url, "${FAKE.supabaseServiceRole}");`,
  `const gh = "${FAKE.githubToken}"; const slack = "${FAKE.slackToken}";`,
  `const maps = "${FAKE.googleApiKey}";`,
  `sendgrid.setApiKey("${FAKE.sendgridApiKey}");`,
  `const twilioKey = "${FAKE.twilioApiKey}";`,
  `TWILIO_AUTH_TOKEN=${FAKE.twilioAuthToken}`,
  `const testKey = "${FAKE.stripeTestKey}";`,
  `const session = "${FAKE.jwt}";`,
  `const clientSecret = "${alnum(40, 5)}";`,
  `const opaque = "${alnum(40, 6)}";`,
  ...FAKE.pemLines,
].join("\n");

describe("scanFile: corpus de verdaderos positivos", () => {
  const detections = scan(TRUE_POSITIVE_FILE);
  const summary = detections.map((d) => [d.line, d.secretType, d.severity, d.method]);

  it("detecta cada secreto con su tipo, severidad, método y línea", () => {
    expect(summary).toEqual([
      [2, "aws_access_key", "critical", "regex"],
      [3, "aws_secret_key", "critical", "regex"],
      [4, "stripe_live_key", "critical", "regex"],
      [5, "connection_string", "critical", "regex"],
      [6, "supabase_service_role_jwt", "critical", "regex"],
      [7, "github_token", "high", "regex"],
      [7, "slack_token", "high", "regex"],
      [8, "google_api_key", "high", "regex"],
      [9, "sendgrid_api_key", "high", "regex"],
      [10, "twilio_api_key", "high", "regex"],
      [11, "twilio_auth_token", "high", "regex"],
      [12, "stripe_test_key", "medium", "regex"],
      [13, "jwt", "medium", "regex"],
      [14, "high_entropy_string_with_context", "medium", "entropy"],
      [15, "high_entropy_string", "low", "entropy"],
      [16, "private_key_pem", "critical", "regex"],
    ]);
  });

  it("ninguna detección contiene texto plano (JSON serializado)", () => {
    expectNoPlaintext(detections);
  });

  it("las huellas son HMAC hex y las máscaras revelan como máximo 8 caracteres", () => {
    for (const d of detections) {
      expect(d.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(d.maskedValue.replace(/\.\.\.|\*/g, "").length).toBeLessThanOrEqual(8);
    }
  });

  it("dos secretos en la misma línea comparten un contexto con ambos enmascarados", () => {
    const line7 = detections.filter((d) => d.line === 7);
    expect(line7).toHaveLength(2);
    expect(line7[0]?.maskedContext).toBe(line7[1]?.maskedContext);
    expect(line7[0]?.maskedContext).not.toContain(FAKE.githubToken);
    expect(line7[0]?.maskedContext).not.toContain(FAKE.slackToken);
    expect(line7[0]?.maskedContext).toContain("const gh = ");
  });

  it("es determinista", () => {
    expect(scan(TRUE_POSITIVE_FILE)).toEqual(detections);
  });
});

describe("scanFile: corpus de falsos positivos (cero hallazgos)", () => {
  const integrity = "sha512-" + createHash("sha512").update("leat").digest("base64");
  const commit = createHash("sha1").update("leat").digest("hex");
  const image = createHash("sha512").update("img").digest("base64").repeat(8);

  it.each([
    [
      "código TypeScript común",
      [
        'import { createClient } from "@supabase/supabase-js";',
        "export async function getUserProfileByIdentifier(id: string) {",
        "  const { data, error } = await supabase.from('profiles').select('*').eq('id', id);",
        "  if (error) throw new Error(`No se pudo leer el perfil: ${error.message}`);",
        "  return data;",
        "}",
      ].join("\n"),
    ],
    [
      "variables de entorno leídas, no escritas",
      [
        "const key = process.env.STRIPE_SECRET_KEY;",
        "const password = config.get('database.password');",
        'const DATABASE_URL = "postgres://app:${DB_PASSWORD}@localhost:5432/leat";',
      ].join("\n"),
    ],
    [
      "identificadores y hashes públicos",
      [
        `const id = "${randomUUID()}";`,
        `"integrity": "${integrity}",`,
        `const commit = "${commit}";`,
        'const publishable = "pk_live_" + "x";',
      ].join("\n"),
    ],
    ["imagen incrustada", `.logo { background: url(data:image/png;base64,${image}); }`],
    ["clave pública", ["-----BEGIN " + "PUBLIC KEY-----", alnum(64), "-----END PUBLIC KEY-----"].join("\n")],
  ])("%s", (_label, content) => {
    expect(scan(content)).toEqual([]);
  });

  it("archivos ignorados no se analizan aunque tengan secretos", () => {
    const content = `key = "${FAKE.awsAccessKey}"`;
    expect(scan(content, "node_modules/pkg/index.js")).toEqual([]);
    expect(scan(content, "dist/bundle.min.js")).toEqual([]);
    expect(scan(content, "package-lock.json")).toEqual([]);
    expect(scan(`${content}\u0000`, "data.bin.txt")).toEqual([]);
  });
});

describe("scanFile: claves PEM", () => {
  const multiline = FAKE.pemLines.join("\n");
  const singleLine = `{"private_key": "${FAKE.pemLines.join("\\n")}\\n"}`;

  it("un PEM multilínea es UN hallazgo crítico en la línea del BEGIN, sin ruido de entropía", () => {
    const detections = scan(`// clave\n${multiline}\nconst a = 1;`);
    expect(detections.map((d) => [d.line, d.secretType])).toEqual([[2, "private_key_pem"]]);
    expectNoPlaintext(detections);
  });

  it("detecta el PEM escapado en una sola línea (JSON de cuenta de servicio)", () => {
    const detections = scan(singleLine, "service-account.json");
    expect(detections.map((d) => d.secretType)).toEqual(["private_key_pem"]);
    expect(detections[0]?.maskedContext.startsWith('{"private_key": "')).toBe(true);
    expectNoPlaintext(detections);
  });

  it("la misma clave da la misma huella en ambos formatos y con CRLF", () => {
    const a = scan(multiline)[0]?.fingerprint;
    const b = scan(singleLine)[0]?.fingerprint;
    const c = scan(FAKE.pemLines.join("\r\n"))[0]?.fingerprint;
    expect(a).toBeDefined();
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("salta el cuerpo de un certificado pero sigue analizando después del END", () => {
    const content = [
      "-----BEGIN " + "CERTIFICATE-----",
      alnum(64, 1),
      alnum(64, 2),
      "-----END CERTIFICATE-----",
      `k = "${FAKE.awsAccessKey}"`,
    ].join("\n");
    expect(scan(content).map((d) => [d.line, d.secretType])).toEqual([[5, "aws_access_key"]]);
  });

  it("un BEGIN sin END se reporta igual (clave truncada)", () => {
    const truncated = FAKE.pemLines.slice(0, 3).join("\n");
    expect(scan(truncated).map((d) => d.secretType)).toEqual(["private_key_pem"]);
  });
});

describe("scanFile: líneas y límites", () => {
  it("numera líneas igual con LF, CRLF y CR", () => {
    for (const eol of ["\n", "\r\n", "\r"]) {
      const content = ["a", "b", `k = "${FAKE.awsAccessKey}"`].join(eol);
      expect(scan(content)[0]?.line).toBe(3);
    }
  });

  it("no analiza ni guarda lo que excede la longitud máxima de línea", () => {
    const padding = "x".repeat(SCAN_LIMITS.maxLineLength);
    const detections = scan(`${padding} ${FAKE.awsAccessKey} ${FAKE.githubToken}`);
    expect(detections).toEqual([]);

    const early = scan(`${FAKE.githubToken} ${padding} ${FAKE.awsAccessKey}`);
    expect(early.map((d) => d.secretType)).toEqual(["github_token"]);
    expect(early[0]?.maskedContext.length).toBeLessThanOrEqual(SCAN_LIMITS.maxLineLength);
    expect(early[0]?.maskedContext).not.toContain(FAKE.awsAccessKey);
  });

  it("la huella depende del pepper", () => {
    const content = `k = "${FAKE.awsAccessKey}"`;
    const a = scanFile({ path: "a.ts", content }, { pepper: PEPPER })[0]?.fingerprint;
    const b = scanFile({ path: "a.ts", content }, { pepper: alnum(64, 22) })[0]?.fingerprint;
    expect(a).not.toBe(b);
  });

  it("rechaza un pepper inválido", () => {
    expect(() => scanFile({ path: "a.ts", content: `k="${FAKE.awsAccessKey}"` }, { pepper: "x" })).toThrow();
  });

  it("un JWT con otro rol no se reporta como service_role", () => {
    const [d] = scan(`token = "${fakeJwt({ role: "anon" })}"`);
    expect(d?.secretType).toBe("jwt");
  });
});

describe("scanFile: tiempo acotado (ReDoS)", () => {
  const LINE = SCAN_LIMITS.maxLineLength;
  const pathologicalLines = [
    "a".repeat(LINE),
    "eyJ".repeat(LINE / 3),
    "postgres://" + "a:".repeat(LINE / 2 - 6),
    "-----BEGIN " + "PRIVATE KEY-----" + "=".repeat(LINE),
    "aws_secret_key=" + "A/".repeat(LINE / 2),
    alnum(LINE),
    "a=".repeat(LINE / 2),
  ];

  it("500 líneas patológicas de 2,000 caracteres en menos de 3 s", () => {
    const content = Array.from({ length: 500 }, (_, i) => pathologicalLines[i % pathologicalLines.length]).join("\n");
    const startedAt = performance.now();
    scan(content, "patologico.txt");
    expect(performance.now() - startedAt).toBeLessThan(3000);
  });

  it("una línea de 1 MB se recorta y se analiza rápido", () => {
    const startedAt = performance.now();
    scan("x".repeat(SCAN_LIMITS.maxFileBytes - 10), "una-linea.txt");
    expect(performance.now() - startedAt).toBeLessThan(500);
  });

  it("un PEM con miles de líneas de cuerpo respeta maxLines", () => {
    const content = ["-----BEGIN " + "PRIVATE KEY-----", ...Array.from({ length: 5000 }, () => alnum(64))].join("\n");
    const startedAt = performance.now();
    const detections = scan(content, "huge.pem");
    expect(performance.now() - startedAt).toBeLessThan(3000);
    expect(detections[0]?.secretType).toBe("private_key_pem");
    expectNoPlaintext(detections);
  });
});
