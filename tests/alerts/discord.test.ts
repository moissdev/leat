import { describe, expect, it } from "vitest";
import {
  buildAlertPayload,
  discordWebhookUrlSchema,
  MAX_LISTED_FINDINGS,
  SEVERITY_COLORS,
  type AlertFinding,
} from "@/lib/alerts/discord";
import { maskSecret } from "@/lib/engine/mask";
import { alnum, FAKE } from "../fixtures/secrets";

const ID = "123456789012345678";
const TOKEN = alnum(68, 2);

describe("discordWebhookUrlSchema", () => {
  it.each([
    `https://discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discordapp.com/api/webhooks/${ID}/${TOKEN}`,
    `https://ptb.discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://canary.discord.com/api/v10/webhooks/${ID}/${TOKEN}`,
  ])("acepta %s", (url) => {
    expect(discordWebhookUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    `http://discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com.evil.example/api/webhooks/${ID}/${TOKEN}`,
    `https://evil.example/api/webhooks/${ID}/${TOKEN}`,
    `https://user:pass@discord.com/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com:8443/api/webhooks/${ID}/${TOKEN}`,
    `https://discord.com/api/webhooks/${ID}/${TOKEN}?wait=true`,
    `https://discord.com/api/webhooks/${ID}/${TOKEN}/slack`,
    `https://discord.com/api/webhooks/abc/${TOKEN}`,
    `https://discord.com/api/webhooks/${ID}/short`,
    `https://localhost/api/webhooks/${ID}/${TOKEN}`,
    "",
  ])("rechaza %s", (url) => {
    expect(discordWebhookUrlSchema.safeParse(url).success).toBe(false);
  });
});

describe("buildAlertPayload", () => {
  const finding = (overrides: Partial<AlertFinding> = {}): AlertFinding => ({
    severity: "high",
    secretType: "github_token",
    maskedValue: maskSecret(FAKE.githubToken),
    filePath: "src/config.ts",
    lineNumber: 12,
    reopened: false,
    ...overrides,
  });
  const base = { projectName: "Mi proyecto", scanId: "abcdef12-3456", scanUrl: null, timestamp: new Date(0) };

  it("un embed por escaneo, coral si hay críticas y ámbar si solo hay altas", () => {
    const critical = buildAlertPayload({ ...base, findings: [finding(), finding({ severity: "critical" })] });
    const high = buildAlertPayload({ ...base, findings: [finding()] });
    const embeds = (p: Record<string, unknown>) => p.embeds as { color: number; fields: { value: string }[] }[];
    expect(embeds(critical)).toHaveLength(1);
    expect(embeds(critical)[0]?.color).toBe(SEVERITY_COLORS.critical);
    expect(embeds(high)[0]?.color).toBe(SEVERITY_COLORS.high);
    expect(embeds(critical)[0]?.fields.map((f) => f.value)).toEqual(["1", "1"]);
  });

  it("solo lleva datos enmascarados", () => {
    const payload = JSON.stringify(
      buildAlertPayload({
        ...base,
        findings: [
          finding({ maskedValue: maskSecret(FAKE.githubToken) }),
          finding({ severity: "critical", secretType: "aws_access_key", maskedValue: maskSecret(FAKE.awsAccessKey) }),
        ],
      }),
    );
    expect(payload).not.toContain(FAKE.githubToken);
    expect(payload).not.toContain(FAKE.awsAccessKey);
    expect(payload).toContain(maskSecret(FAKE.awsAccessKey));
  });

  it("desactiva menciones y neutraliza backticks en rutas", () => {
    const payload = buildAlertPayload({
      ...base,
      findings: [finding({ filePath: "@everyone `rm -rf`.ts" })],
    });
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    const description = (payload.embeds as { description: string }[])[0]?.description ?? "";
    expect(description).not.toContain("`rm -rf`");
  });

  it("limita la lista y resume el resto", () => {
    const many = Array.from({ length: MAX_LISTED_FINDINGS + 5 }, () => finding());
    const description = (buildAlertPayload({ ...base, findings: many }).embeds as { description: string }[])[0]?.description ?? "";
    expect(description.split("\n")).toHaveLength(MAX_LISTED_FINDINGS + 1);
    expect(description).toContain("y 5 más");
  });

  it("marca los hallazgos reabiertos", () => {
    const description =
      (buildAlertPayload({ ...base, findings: [finding({ reopened: true })] }).embeds as { description: string }[])[0]
        ?.description ?? "";
    expect(description).toContain("(reabierto)");
  });
});
