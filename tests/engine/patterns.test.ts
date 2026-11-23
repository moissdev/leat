import { describe, expect, it } from "vitest";
import {
  LINE_PATTERNS,
  matchLinePatterns,
  PATTERNS,
  PEM_PRIVATE_KEY,
} from "@/lib/engine/patterns";
import type { Severity } from "@/lib/engine/types";
import { alnum, FAKE, fakeJwt, hex } from "../fixtures/secrets";

/** IDs detectados en una línea. */
function idsIn(text: string): string[] {
  return matchLinePatterns(text).map((m) => m.pattern.id);
}

interface PatternCase {
  id: string;
  positive: string;
  secret: string;
  nearMisses: string[];
}

const cases: PatternCase[] = [
  {
    id: "aws_access_key",
    positive: `const accessKeyId = "${FAKE.awsAccessKey}";`,
    secret: FAKE.awsAccessKey,
    nearMisses: [
      `id = "${"AKIA" + "IOSFODNN7EXAMP"}"`, // 14 caracteres tras el prefijo
      `id = "${"AKIB" + "IOSFODNN7EXAMPLE"}"`, // prefijo inexistente
      `id = "${"AKIA" + "IOSFODNN7EXAMPLE" + "X"}"`, // demasiado largo
    ],
  },
  {
    id: "aws_secret_key",
    positive: `AWS_SECRET_ACCESS_KEY=${FAKE.awsSecretKey}`,
    secret: FAKE.awsSecretKey,
    nearMisses: [
      `value = "${FAKE.awsSecretKey}"`, // sin contexto: queda para la entropía
      `AWS_SECRET_ACCESS_KEY=${FAKE.awsSecretKey.slice(1)}`, // 39 caracteres
    ],
  },
  {
    id: "stripe_live_key",
    positive: `stripe.setKey("${FAKE.stripeLiveKey}")`,
    secret: FAKE.stripeLiveKey,
    nearMisses: [
      `key = "${"sk_" + "live_" + alnum(10)}"`, // demasiado corto
      `key = "${"pk_" + "live_" + alnum(24)}"`, // publicable, no secreta
    ],
  },
  {
    id: "connection_string",
    positive: `DATABASE_URL=${"postgres://app:" + FAKE.dbPassword + "@db.example.com:5432/leat"}`,
    secret: FAKE.dbPassword,
    nearMisses: [
      "DATABASE_URL=postgres://app@db.example.com/leat", // sin contraseña
      "DATABASE_URL=postgres://app:${DB_PASSWORD}@db.example.com/leat", // plantilla
      "MONGO=mongodb+srv://app:<password>@cluster0.example.net", // marcador de docs
      "url = https://user:pass@example.com", // esquema que no es de base de datos
    ],
  },
  {
    id: "supabase_service_role_jwt",
    positive: `SUPABASE_KEY="${FAKE.supabaseServiceRole}"`,
    secret: FAKE.supabaseServiceRole,
    nearMisses: [`SUPABASE_KEY="${fakeJwt({ iss: "supabase", role: "anon" })}"`],
  },
  {
    id: "github_token",
    positive: `token: ${FAKE.githubToken}`,
    secret: FAKE.githubToken,
    nearMisses: [`token: ${"ghp_" + alnum(20)}`, `token: ${"ghx_" + alnum(36)}`],
  },
  {
    id: "github_fine_grained_token",
    positive: `GH=${FAKE.githubFineGrained}`,
    secret: FAKE.githubFineGrained,
    nearMisses: [`GH=${"github_pat_" + alnum(22) + "_" + alnum(40)}`],
  },
  {
    id: "slack_token",
    positive: `SLACK_BOT_TOKEN=${FAKE.slackToken}`,
    secret: FAKE.slackToken,
    nearMisses: [`SLACK=${"xox" + "b-123"}`, `SLACK=${"xox" + "z-1234567890-" + alnum(24)}`],
  },
  {
    id: "google_api_key",
    positive: `const maps = "${FAKE.googleApiKey}";`,
    secret: FAKE.googleApiKey,
    nearMisses: [`const maps = "${"AIza" + alnum(20)}";`],
  },
  {
    id: "sendgrid_api_key",
    positive: `SENDGRID_API_KEY='${FAKE.sendgridApiKey}'`,
    secret: FAKE.sendgridApiKey,
    nearMisses: [`SENDGRID='${"SG." + alnum(10) + "." + alnum(10)}'`],
  },
  {
    id: "twilio_api_key",
    positive: `twilio.apiKey = "${FAKE.twilioApiKey}"`,
    secret: FAKE.twilioApiKey,
    nearMisses: [`sid = "${"SK" + hex(31)}"`, `sid = "${"SK" + "G".repeat(32)}"`],
  },
  {
    id: "twilio_auth_token",
    positive: `TWILIO_AUTH_TOKEN=${FAKE.twilioAuthToken}`,
    secret: FAKE.twilioAuthToken,
    nearMisses: [`checksum=${FAKE.twilioAuthToken}`],
  },
  {
    id: "stripe_test_key",
    positive: `STRIPE_SECRET_KEY=${FAKE.stripeTestKey}`,
    secret: FAKE.stripeTestKey,
    nearMisses: [`STRIPE=${"sk_" + "test_" + alnum(8)}`],
  },
  {
    id: "jwt",
    positive: `Authorization: Bearer ${FAKE.jwt}`,
    secret: FAKE.jwt,
    // Forma de JWT pero los segmentos no decodifican a JSON.
    nearMisses: [`x = "${"eyJ" + alnum(20) + ".eyJ" + alnum(20) + "." + alnum(20)}"`],
  },
];

describe("catálogo de patrones de línea", () => {
  it("cubre todos los patrones de línea del catálogo", () => {
    expect(cases.map((c) => c.id).sort()).toEqual(LINE_PATTERNS.map((p) => p.id).sort());
  });

  it.each(cases)("$id: detecta el positivo y captura el secreto exacto", ({ id, positive, secret }) => {
    const matches = matchLinePatterns(positive);
    expect(matches).toHaveLength(1);
    const [match] = matches;
    expect(match?.pattern.id).toBe(id);
    expect(match?.secret).toBe(secret);
    expect(positive.slice(match?.start, match?.end)).toBe(secret);
  });

  it.each(cases)("$id: ignora los casi-positivos", ({ id, nearMisses }) => {
    for (const text of nearMisses) {
      expect(idsIn(text), text).not.toContain(id);
    }
  });
});

describe("severidades (decisiones técnicas, 4.1)", () => {
  const expected: Record<string, Severity> = {
    private_key_pem: "critical",
    aws_access_key: "critical",
    aws_secret_key: "critical",
    stripe_live_key: "critical",
    connection_string: "critical",
    supabase_service_role_jwt: "critical",
    github_token: "high",
    github_fine_grained_token: "high",
    slack_token: "high",
    google_api_key: "high",
    sendgrid_api_key: "high",
    twilio_api_key: "high",
    twilio_auth_token: "high",
    stripe_test_key: "medium",
    jwt: "medium",
  };

  it("cada patrón tiene la severidad acordada", () => {
    expect(Object.fromEntries(PATTERNS.map((p) => [p.id, p.severity]))).toEqual(expected);
  });

  it("los ids son únicos", () => {
    const ids = PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("los patrones de línea van de mayor a menor severidad", () => {
    const rank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const ranks = LINE_PATTERNS.map((p) => rank[p.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("todas las regex de línea son globales y con índices", () => {
    for (const p of LINE_PATTERNS) {
      expect(p.regex.flags, p.id).toContain("g");
      expect(p.regex.flags, p.id).toContain("d");
    }
  });
});

describe("resolución de solapes y posiciones", () => {
  it("un JWT service_role se reporta solo como crítico, no además como JWT genérico", () => {
    expect(idsIn(`key=${FAKE.supabaseServiceRole}`)).toEqual(["supabase_service_role_jwt"]);
  });

  it("un JWT con otro rol queda como JWT genérico", () => {
    expect(idsIn(`key=${fakeJwt({ role: "anon" })}`)).toEqual(["jwt"]);
  });

  it("ubica la contraseña aunque coincida con el usuario", () => {
    const pass = "rep" + "eated99";
    const text = `postgres://${pass}:${pass}@db.example.com/app`;
    const [match] = matchLinePatterns(text);
    expect(match?.start).toBe(text.indexOf(`:${pass}@`) + 1);
  });

  it("detecta varios secretos en la misma línea, ordenados por posición", () => {
    const text = `${FAKE.githubToken} ${FAKE.awsAccessKey}`;
    expect(idsIn(text)).toEqual(["github_token", "aws_access_key"]);
  });

  it("es reentrante: dos llamadas seguidas dan el mismo resultado", () => {
    const text = `a=${FAKE.awsAccessKey}`;
    expect(matchLinePatterns(text)).toEqual(matchLinePatterns(text));
  });
});

describe("clave privada PEM (patrón de bloque)", () => {
  it("reconoce el inicio y el fin de claves privadas", () => {
    const [begin, , , end] = FAKE.pemLines;
    expect(PEM_PRIVATE_KEY.begin.test(begin)).toBe(true);
    expect(PEM_PRIVATE_KEY.end.test(end)).toBe(true);
    expect(PEM_PRIVATE_KEY.begin.test("-----BEGIN " + "OPENSSH PRIVATE KEY-----")).toBe(true);
    expect(PEM_PRIVATE_KEY.begin.test("-----BEGIN " + "PRIVATE KEY-----")).toBe(true);
  });

  it("ignora claves públicas y certificados", () => {
    expect(PEM_PRIVATE_KEY.begin.test("-----BEGIN " + "PUBLIC KEY-----")).toBe(false);
    expect(PEM_PRIVATE_KEY.begin.test("-----BEGIN " + "CERTIFICATE-----")).toBe(false);
  });
});

describe("tiempo acotado con entradas patológicas (ReDoS)", () => {
  const MAX_LINE = 2000;
  const pathological = [
    "a".repeat(MAX_LINE),
    "eyJ".repeat(MAX_LINE / 3),
    "eyJ" + "a".repeat(900) + "." + "eyJ" + "a".repeat(900) + ".",
    "postgres://" + "a:".repeat(MAX_LINE / 2 - 6),
    "mongodb://u:" + "p".repeat(MAX_LINE - 13),
    "aws_secret_key=" + "A".repeat(MAX_LINE - 15),
    "xoxb-" + "1".repeat(MAX_LINE - 5),
    "-".repeat(MAX_LINE),
  ];

  it.each(pathological.map((text, i) => [i, text] as const))(
    "entrada %i se evalúa en menos de 50 ms",
    (_i, text) => {
      const startedAt = performance.now();
      matchLinePatterns(text);
      PEM_PRIVATE_KEY.begin.test(text);
      expect(performance.now() - startedAt).toBeLessThan(50);
    },
  );
});
