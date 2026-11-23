import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { PersistenceError } from "../scans/persist";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "./crypto";
import type { AlertSeverity } from "./discord";
import type { AlertAttemptLog, AlertStore } from "./dispatch";

/**
 * Persistencia de alertas con el cliente admin (service_role): webhook cifrado
 * en `user_settings`, hallazgos a alertar y registro en `alert_logs`.
 * Todas las consultas filtran por `user_id`. El webhook descifrado solo vive
 * en memoria del servidor y nunca se devuelve al cliente.
 */

type AdminClient = SupabaseClient<Database>;

function fail(operation: string, error: { code?: string } | null): never {
  throw new PersistenceError(operation, error?.code);
}

/** Proveedor de la clave por versión (rotación con `key_version`). */
export type KeyProvider = (version: number) => Buffer;

export class SupabaseAlertStore implements AlertStore {
  constructor(
    private readonly db: AdminClient,
    private readonly keyFor: KeyProvider,
  ) {}

  /** Webhook descifrado; con `requireEnabled` devuelve null si las alertas están desactivadas. */
  async getWebhookUrl(userId: string, options: { requireEnabled: boolean }): Promise<string | null> {
    const { data, error } = await this.db
      .from("user_settings")
      .select("discord_webhook_ct, discord_webhook_iv, discord_webhook_tag, encryption_key_version, alerts_enabled")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) fail("getWebhookUrl", error);
    if (!data?.discord_webhook_ct || !data.discord_webhook_iv || !data.discord_webhook_tag) return null;
    if (options.requireEnabled && !data.alerts_enabled) return null;

    const secret: EncryptedSecret = {
      ciphertext: data.discord_webhook_ct,
      iv: data.discord_webhook_iv,
      tag: data.discord_webhook_tag,
      keyVersion: data.encryption_key_version,
    };
    return decryptSecret(secret, this.keyFor(secret.keyVersion), userId);
  }

  getActiveWebhookUrl(userId: string): Promise<string | null> {
    return this.getWebhookUrl(userId, { requireEnabled: true });
  }

  async saveWebhookUrl(userId: string, url: string, keyVersion: number): Promise<void> {
    const secret = encryptSecret(url, this.keyFor(keyVersion), userId);
    const { error } = await this.db.from("user_settings").upsert(
      {
        user_id: userId,
        discord_webhook_ct: secret.ciphertext,
        discord_webhook_iv: secret.iv,
        discord_webhook_tag: secret.tag,
        encryption_key_version: secret.keyVersion,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) fail("saveWebhookUrl", error);
  }

  async deleteWebhookUrl(userId: string): Promise<void> {
    const { error } = await this.db
      .from("user_settings")
      .update({
        discord_webhook_ct: null,
        discord_webhook_iv: null,
        discord_webhook_tag: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (error) fail("deleteWebhookUrl", error);
  }

  async getProjectName(userId: string, projectId: string): Promise<string> {
    const { data, error } = await this.db
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) fail("getProjectName", error);
    return data?.name ?? "proyecto";
  }

  async getAlertableFindings(userId: string, scanId: string, findingIds: readonly string[]) {
    const findings: {
      id: string;
      severity: AlertSeverity;
      secretType: string;
      maskedValue: string;
      filePath: string | null;
      lineNumber: number | null;
    }[] = [];

    for (let i = 0; i < findingIds.length; i += 100) {
      const batch = findingIds.slice(i, i + 100);
      const { data, error } = await this.db
        .from("findings")
        .select("id, severity, secret_type, masked_value")
        .eq("user_id", userId)
        .eq("status", "active")
        .in("severity", ["critical", "high"])
        .in("id", batch);
      if (error) fail("getAlertableFindings", error);

      const ids = (data ?? []).map((f) => f.id);
      const firstLocation = new Map<string, { filePath: string; lineNumber: number }>();
      if (ids.length > 0) {
        const occ = await this.db
          .from("finding_occurrences")
          .select("finding_id, file_path, line_number")
          .eq("user_id", userId)
          .eq("scan_id", scanId)
          .in("finding_id", ids)
          .order("file_path")
          .order("line_number");
        if (occ.error) fail("getAlertableFindings", occ.error);
        for (const o of occ.data ?? []) {
          if (!firstLocation.has(o.finding_id)) {
            firstLocation.set(o.finding_id, { filePath: o.file_path, lineNumber: o.line_number });
          }
        }
      }

      for (const f of data ?? []) {
        if (f.severity !== "critical" && f.severity !== "high") continue;
        const location = firstLocation.get(f.id);
        findings.push({
          id: f.id,
          severity: f.severity,
          secretType: f.secret_type,
          maskedValue: f.masked_value,
          filePath: location?.filePath ?? null,
          lineNumber: location?.lineNumber ?? null,
        });
      }
    }
    return findings;
  }

  async logAttempt(entry: AlertAttemptLog): Promise<void> {
    const { error } = await this.db.from("alert_logs").insert({
      user_id: entry.userId,
      scan_id: entry.scanId,
      severity: entry.severity,
      attempt: entry.attempt,
      success: entry.success,
      http_status: entry.httpStatus,
      error: entry.error,
    });
    if (error) fail("logAttempt", error);
  }
}
