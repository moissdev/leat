import "server-only";
import { createSupabaseAdminClient } from "../supabase/admin";
import { getWebhookEncryptionKey } from "../server-env";
import { dispatchScanAlerts, type DispatchOutcome, type ScanAlertRequest } from "./dispatch";
import { SupabaseAlertStore } from "./store";

/** Envía las alertas de un escaneo con las dependencias reales. Nunca lanza. */
export function sendScanAlerts(request: ScanAlertRequest): Promise<DispatchOutcome> {
  return dispatchScanAlerts(
    {
      store: new SupabaseAlertStore(createSupabaseAdminClient(), getWebhookEncryptionKey),
      fetch,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
    },
    request,
  );
}
