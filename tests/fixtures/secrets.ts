/**
 * Secretos FALSOS para pruebas. Se arman en tiempo de ejecución concatenando
 * fragmentos para que ningún valor completo aparezca literal en el repositorio
 * (ni dispare la protección de push de GitHub ni al propio LEAT).
 */

// Alfabeto armado por fragmentos: escrito completo, el propio LEAT lo marcaría por entropía.
const ALNUM = ["aB3dE5gH", "7jK9mN1p", "Q2sT4vW6", "yZ8cF0hJ"].join("");
const HEX = "0123456789abcdef";

/** Cadena determinista de `length` caracteres alfanuméricos. */
export function alnum(length: number, offset = 0): string {
  return Array.from({ length }, (_, i) => ALNUM[(i * 7 + offset) % ALNUM.length]).join("");
}

/** Cadena determinista de `length` caracteres hexadecimales en minúscula. */
export function hex(length: number, offset = 0): string {
  return Array.from({ length }, (_, i) => HEX[(i * 5 + offset) % HEX.length]).join("");
}

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** JWT falso (firma inventada) con el payload indicado. */
export function fakeJwt(payload: object): string {
  return [b64url({ alg: "HS256", typ: "JWT" }), b64url(payload), alnum(43, 3)].join(".");
}

export const FAKE = {
  awsAccessKey: "AKIA" + "IOSFODNN7EXAMPLE",
  awsSecretKey: "wJalrXUtnFEMI/K7MDENG/" + "bPxRfiCYEXAMPLEKEY",
  stripeLiveKey: "sk_" + "live_" + alnum(24),
  stripeRestrictedKey: "rk_" + "live_" + alnum(30, 1),
  stripeTestKey: "sk_" + "test_" + alnum(24, 2),
  dbPassword: "s3cr" + "etPa55w0rd",
  githubToken: "ghp_" + alnum(36, 4),
  githubFineGrained: "github_pat_" + alnum(22, 5) + "_" + alnum(59, 6),
  slackToken: "xox" + "b-" + "1234567890" + "-" + alnum(24, 7),
  googleApiKey: "AIza" + alnum(35, 8),
  sendgridApiKey: "SG." + alnum(22, 9) + "." + alnum(43, 10),
  twilioApiKey: "SK" + hex(32),
  twilioAuthToken: hex(32, 3),
  jwt: fakeJwt({ sub: "1234567890", role: "authenticated" }),
  supabaseServiceRole: fakeJwt({ iss: "supabase", role: "service" + "_role" }),
  pemLines: [
    "-----BEGIN " + "RSA PRIVATE KEY-----",
    "MIIE" + alnum(60, 11),
    alnum(64, 12),
    "-----END " + "RSA PRIVATE KEY-----",
  ],
} as const;
