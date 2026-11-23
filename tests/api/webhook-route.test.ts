import { beforeEach, describe, expect, it, vi } from "vitest";
import { alnum } from "../fixtures/secrets";

/**
 * La ruta /api/settings/webhook nunca devuelve la URL del webhook: se prueban
 * PUT, POST y DELETE con la sesión y la persistencia simuladas.
 */

const WEBHOOK = "https://discord.com/api/webhooks/" + "123456789012345678" + "/" + alnum(68, 6);
const saved: { url: string | null } = { url: null };

vi.mock("@/lib/supabase/session", () => ({
  getSessionUser: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111", email: "a@b.co" })),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/server-env", () => ({ getWebhookEncryptionKey: vi.fn(() => Buffer.alloc(32)) }));
vi.mock("@/lib/alerts/store", () => ({
  SupabaseAlertStore: class {
    async saveWebhookUrl(_userId: string, url: string) {
      saved.url = url;
    }
    async deleteWebhookUrl() {
      saved.url = null;
    }
    async getWebhookUrl() {
      return saved.url;
    }
  },
}));
vi.mock("@/lib/alerts/dispatch", () => ({
  postWebhook: vi.fn(async () => ({ success: true, httpStatus: 204, error: null, retryable: false, retryAfterMs: null })),
}));

const { DELETE, POST, PUT } = await import("@/app/api/settings/webhook/route");
const { getSessionUser } = await import("@/lib/supabase/session");

const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/settings/webhook", { method: "PUT", body: JSON.stringify(body) }));

describe("/api/settings/webhook", () => {
  beforeEach(() => {
    saved.url = null;
  });

  it("PUT guarda el webhook y responde solo que está configurado", async () => {
    const response = await put({ url: WEBHOOK });
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ webhook_configured: true });
    expect(text).not.toContain(WEBHOOK);
    expect(text).not.toContain(WEBHOOK.split("/").pop());
    expect(saved.url).toBe(WEBHOOK);
  });

  it("PUT rechaza URLs que no son de Discord sin repetirlas en el error", async () => {
    const evil = "https://evil.example/api/webhooks/1/" + alnum(68);
    const response = await put({ url: evil });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("evil.example");
    expect(saved.url).toBeNull();
  });

  it("POST envía la prueba sin devolver la URL", async () => {
    saved.url = WEBHOOK;
    const response = await POST();
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ sent: true });
    expect(text).not.toContain(WEBHOOK);
  });

  it("POST sin webhook configurado responde 409", async () => {
    expect((await POST()).status).toBe(409);
  });

  it("DELETE responde que ya no está configurado", async () => {
    saved.url = WEBHOOK;
    const response = await DELETE();
    expect(await response.json()).toEqual({ webhook_configured: false });
    expect(saved.url).toBeNull();
  });

  it("sin sesión responde 401 en los tres métodos", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    expect((await put({ url: WEBHOOK })).status).toBe(401);
    expect((await POST()).status).toBe(401);
    expect((await DELETE()).status).toBe(401);
  });
});
