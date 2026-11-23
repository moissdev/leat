import type { Enums } from "@/types/database";

/**
 * Etiquetas en español de la interfaz. Los valores de base de datos y del
 * código quedan en inglés; aquí solo se traducen para mostrarlos.
 */

export type Severity = Enums<"severity_level">;
export type FindingStatus = Enums<"finding_status">;
export type ScanStatus = Enums<"scan_status">;
export type IngestType = Enums<"ingest_type">;
export type DetectionMethod = Enums<"detection_method">;

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Crítica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

/** De mayor a menor severidad (orden de tablas, filtros y gráficas). */
export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low"];

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  active: "Activa",
  resolved: "Resuelta",
  ignored: "Ignorada",
  false_positive: "Falso positivo",
};

export const SCAN_STATUS_LABELS: Record<ScanStatus, string> = {
  queued: "En cola",
  running: "En curso",
  completed: "Completado",
  failed: "Fallido",
};

export const INGEST_LABELS: Record<IngestType, string> = {
  snippet: "Fragmento",
  file: "Archivo",
  zip: "ZIP",
  github: "GitHub",
};

export const DETECTION_METHOD_LABELS: Record<DetectionMethod, string> = {
  regex: "Patrón",
  entropy: "Entropía",
};

/** Nombre legible de cada tipo de secreto del catálogo (`findings.secret_type`). */
export const SECRET_TYPE_LABELS: Record<string, string> = {
  private_key_pem: "Clave privada PEM",
  aws_access_key: "AWS Access Key",
  aws_secret_key: "AWS Secret Key",
  stripe_live_key: "Stripe (producción)",
  connection_string: "Connection string",
  supabase_service_role_jwt: "Supabase service_role",
  github_token: "Token de GitHub",
  github_fine_grained_token: "Token de GitHub (grano fino)",
  slack_token: "Token de Slack",
  google_api_key: "Google API key",
  sendgrid_api_key: "SendGrid API key",
  twilio_api_key: "Twilio API key",
  twilio_auth_token: "Twilio Auth Token",
  stripe_test_key: "Stripe (pruebas)",
  jwt: "JSON Web Token",
  high_entropy_string_with_context: "Alta entropía con contexto",
  high_entropy_string: "Alta entropía",
};

/** Etiqueta del tipo de secreto; si no está en el catálogo, se muestra el identificador. */
export function secretTypeLabel(secretType: string): string {
  return SECRET_TYPE_LABELS[secretType] ?? secretType;
}

/** Motivos de fallo de un escaneo (`scans.error_message`). */
export const SCAN_ERROR_LABELS: Record<string, string> = {
  timeout: "Sin actividad por más de 15 minutos",
  repo_not_found: "El repositorio no existe o no es accesible",
  repo_not_public: "El repositorio no es público",
  github_unavailable: "GitHub no respondió; intenta más tarde",
  tarball_error: "No se pudo descargar el repositorio",
  internal_error: "Error interno",
};

/** Motivos que el sistema escribe en el log de transiciones (`reason`). */
export const LIFECYCLE_REASON_LABELS: Record<string, string> = {
  first_detected: "Primera detección",
  redetected: "Detectado de nuevo en un escaneo",
  no_longer_detected: "Ya no apareció en un escaneo completo",
};

/** Motivo legible: los del sistema se traducen; las notas del usuario se muestran tal cual. */
export function lifecycleReasonLabel(reason: string): string {
  return LIFECYCLE_REASON_LABELS[reason] ?? reason;
}
