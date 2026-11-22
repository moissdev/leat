/**
 * Tipos de la base de datos de LEAT (esquema `public`).
 *
 * Siguen el formato de `supabase gen types typescript` y reflejan
 * supabase/migrations/001_schema.sql. Si el esquema cambia, regenerar con:
 *   npx supabase gen types typescript --project-id <ref> --schema public > src/types/database.ts
 *
 * Nota: los tipos `Insert`/`Update` describen columnas, no permisos. Qué puede
 * escribir el rol `authenticated` lo deciden los GRANT y las políticas RLS.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      alert_logs: {
        Row: {
          attempt: number;
          channel: string;
          created_at: string;
          error: string | null;
          http_status: number | null;
          id: number;
          scan_id: string | null;
          severity: Database["public"]["Enums"]["severity_level"];
          success: boolean;
          user_id: string;
        };
        Insert: {
          attempt: number;
          channel?: string;
          created_at?: string;
          error?: string | null;
          http_status?: number | null;
          id?: never;
          scan_id?: string | null;
          severity: Database["public"]["Enums"]["severity_level"];
          success: boolean;
          user_id: string;
        };
        Update: {
          attempt?: number;
          channel?: string;
          created_at?: string;
          error?: string | null;
          http_status?: number | null;
          id?: never;
          scan_id?: string | null;
          severity?: Database["public"]["Enums"]["severity_level"];
          success?: boolean;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alert_logs_scan_id_fkey";
            columns: ["scan_id"];
            isOneToOne: false;
            referencedRelation: "scans";
            referencedColumns: ["id"];
          },
        ];
      };
      finding_occurrences: {
        Row: {
          created_at: string;
          file_path: string;
          finding_id: string;
          id: string;
          line_number: number;
          masked_context: string;
          scan_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          file_path: string;
          finding_id: string;
          id?: string;
          line_number: number;
          masked_context: string;
          scan_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          file_path?: string;
          finding_id?: string;
          id?: string;
          line_number?: number;
          masked_context?: string;
          scan_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finding_occurrences_finding_id_fkey";
            columns: ["finding_id"];
            isOneToOne: false;
            referencedRelation: "findings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finding_occurrences_scan_id_fkey";
            columns: ["scan_id"];
            isOneToOne: false;
            referencedRelation: "scans";
            referencedColumns: ["id"];
          },
        ];
      };
      findings: {
        Row: {
          first_detected_at: string;
          first_scan_id: string | null;
          fingerprint: string;
          id: string;
          last_detected_at: string;
          last_scan_id: string | null;
          masked_value: string;
          method: Database["public"]["Enums"]["detection_method"];
          project_id: string;
          resolved_at: string | null;
          secret_type: string;
          severity: Database["public"]["Enums"]["severity_level"];
          status: Database["public"]["Enums"]["finding_status"];
          status_changed_at: string;
          status_note: string | null;
          user_id: string;
        };
        Insert: {
          first_detected_at?: string;
          first_scan_id?: string | null;
          fingerprint: string;
          id?: string;
          last_detected_at?: string;
          last_scan_id?: string | null;
          masked_value: string;
          method: Database["public"]["Enums"]["detection_method"];
          project_id: string;
          resolved_at?: string | null;
          secret_type: string;
          severity: Database["public"]["Enums"]["severity_level"];
          status?: Database["public"]["Enums"]["finding_status"];
          status_changed_at?: string;
          status_note?: string | null;
          user_id: string;
        };
        Update: {
          first_detected_at?: string;
          first_scan_id?: string | null;
          fingerprint?: string;
          id?: string;
          last_detected_at?: string;
          last_scan_id?: string | null;
          masked_value?: string;
          method?: Database["public"]["Enums"]["detection_method"];
          project_id?: string;
          resolved_at?: string | null;
          secret_type?: string;
          severity?: Database["public"]["Enums"]["severity_level"];
          status?: Database["public"]["Enums"]["finding_status"];
          status_changed_at?: string;
          status_note?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "findings_first_scan_id_fkey";
            columns: ["first_scan_id"];
            isOneToOne: false;
            referencedRelation: "scans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "findings_last_scan_id_fkey";
            columns: ["last_scan_id"];
            isOneToOne: false;
            referencedRelation: "scans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "findings_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      projects: {
        Row: {
          created_at: string;
          github_owner: string | null;
          github_repo: string | null;
          id: string;
          name: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          github_owner?: string | null;
          github_repo?: string | null;
          id?: string;
          name: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          github_owner?: string | null;
          github_repo?: string | null;
          id?: string;
          name?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      scan_logs: {
        Row: {
          created_at: string;
          event: string;
          id: number;
          level: string;
          message: string | null;
          metadata: Json;
          scan_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          event: string;
          id?: never;
          level: string;
          message?: string | null;
          metadata?: Json;
          scan_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          event?: string;
          id?: never;
          level?: string;
          message?: string | null;
          metadata?: Json;
          scan_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scan_logs_scan_id_fkey";
            columns: ["scan_id"];
            isOneToOne: false;
            referencedRelation: "scans";
            referencedColumns: ["id"];
          },
        ];
      };
      scans: {
        Row: {
          bytes_scanned: number;
          chunks_received: number;
          created_at: string;
          error_message: string | null;
          files_scanned: number;
          files_skipped: number;
          files_total: number;
          files_truncated: number;
          findings_new: number;
          findings_reopened: number;
          finished_at: string | null;
          id: string;
          ingest: Database["public"]["Enums"]["ingest_type"];
          is_full_scan: boolean;
          occurrences_total: number;
          project_id: string;
          source_ref: string | null;
          started_at: string | null;
          status: Database["public"]["Enums"]["scan_status"];
          user_id: string;
        };
        Insert: {
          bytes_scanned?: number;
          chunks_received?: number;
          created_at?: string;
          error_message?: string | null;
          files_scanned?: number;
          files_skipped?: number;
          files_total?: number;
          files_truncated?: number;
          findings_new?: number;
          findings_reopened?: number;
          finished_at?: string | null;
          id?: string;
          ingest: Database["public"]["Enums"]["ingest_type"];
          is_full_scan?: boolean;
          occurrences_total?: number;
          project_id: string;
          source_ref?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["scan_status"];
          user_id: string;
        };
        Update: {
          bytes_scanned?: number;
          chunks_received?: number;
          created_at?: string;
          error_message?: string | null;
          files_scanned?: number;
          files_skipped?: number;
          files_total?: number;
          files_truncated?: number;
          findings_new?: number;
          findings_reopened?: number;
          finished_at?: string | null;
          id?: string;
          ingest?: Database["public"]["Enums"]["ingest_type"];
          is_full_scan?: boolean;
          occurrences_total?: number;
          project_id?: string;
          source_ref?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["scan_status"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "scans_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      user_settings: {
        Row: {
          alerts_enabled: boolean;
          created_at: string;
          discord_webhook_ct: string | null;
          discord_webhook_iv: string | null;
          discord_webhook_tag: string | null;
          encryption_key_version: number;
          updated_at: string;
          user_id: string;
          webhook_configured: boolean | null;
        };
        Insert: {
          alerts_enabled?: boolean;
          created_at?: string;
          discord_webhook_ct?: string | null;
          discord_webhook_iv?: string | null;
          discord_webhook_tag?: string | null;
          encryption_key_version?: number;
          updated_at?: string;
          user_id: string;
          webhook_configured?: never;
        };
        Update: {
          alerts_enabled?: boolean;
          created_at?: string;
          discord_webhook_ct?: string | null;
          discord_webhook_iv?: string | null;
          discord_webhook_tag?: string | null;
          encryption_key_version?: number;
          updated_at?: string;
          user_id?: string;
          webhook_configured?: never;
        };
        Relationships: [];
      };
      vulnerability_lifecycle_logs: {
        Row: {
          actor: Database["public"]["Enums"]["change_actor"];
          created_at: string;
          finding_id: string;
          from_status: Database["public"]["Enums"]["finding_status"] | null;
          id: number;
          reason: string | null;
          to_status: Database["public"]["Enums"]["finding_status"];
          ttr_seconds: number | null;
          user_id: string;
        };
        Insert: {
          actor: Database["public"]["Enums"]["change_actor"];
          created_at?: string;
          finding_id: string;
          from_status?: Database["public"]["Enums"]["finding_status"] | null;
          id?: never;
          reason?: string | null;
          to_status: Database["public"]["Enums"]["finding_status"];
          ttr_seconds?: number | null;
          user_id: string;
        };
        Update: {
          actor?: Database["public"]["Enums"]["change_actor"];
          created_at?: string;
          finding_id?: string;
          from_status?: Database["public"]["Enums"]["finding_status"] | null;
          id?: never;
          reason?: string | null;
          to_status?: Database["public"]["Enums"]["finding_status"];
          ttr_seconds?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vulnerability_lifecycle_logs_finding_id_fkey";
            columns: ["finding_id"];
            isOneToOne: false;
            referencedRelation: "findings";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      project_score_v: {
        Row: {
          active_critical: number | null;
          active_high: number | null;
          active_low: number | null;
          active_medium: number | null;
          project_id: string | null;
          project_name: string | null;
          score: number | null;
          user_id: string | null;
        };
        Relationships: [];
      };
      scan_report_v: {
        Row: {
          bytes_scanned: number | null;
          created_at: string | null;
          duration_ms: number | null;
          error_message: string | null;
          files_scanned: number | null;
          files_skipped: number | null;
          files_total: number | null;
          files_truncated: number | null;
          findings_new: number | null;
          findings_reopened: number | null;
          finished_at: string | null;
          id: string | null;
          ingest: Database["public"]["Enums"]["ingest_type"] | null;
          is_full_scan: boolean | null;
          occurrences_total: number | null;
          project_id: string | null;
          project_name: string | null;
          source_ref: string | null;
          started_at: string | null;
          status: Database["public"]["Enums"]["scan_status"] | null;
          user_id: string | null;
        };
        Relationships: [];
      };
      ttr_summary_v: {
        Row: {
          avg_ttr_seconds: number | null;
          project_id: string | null;
          resolved_count: number | null;
          severity: Database["public"]["Enums"]["severity_level"] | null;
          user_id: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      change_actor: "user" | "system";
      detection_method: "regex" | "entropy";
      finding_status: "active" | "resolved" | "ignored" | "false_positive";
      ingest_type: "snippet" | "file" | "zip" | "github";
      scan_status: "queued" | "running" | "completed" | "failed";
      severity_level: "critical" | "high" | "medium" | "low";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];

/** Fila de una tabla o vista: `Tables<"findings">`. */
export type Tables<T extends keyof PublicSchema["Tables"] | keyof PublicSchema["Views"]> =
  T extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][T]["Row"]
    : T extends keyof PublicSchema["Views"]
      ? PublicSchema["Views"][T]["Row"]
      : never;

/** Datos de inserción de una tabla: `TablesInsert<"scans">`. */
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];

/** Datos de actualización de una tabla: `TablesUpdate<"findings">`. */
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];

/** Valores de un enum: `Enums<"severity_level">`. */
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

/** Constantes de los enums, útiles para validación con zod y para la UI. */
export const Constants = {
  public: {
    Enums: {
      change_actor: ["user", "system"],
      detection_method: ["regex", "entropy"],
      finding_status: ["active", "resolved", "ignored", "false_positive"],
      ingest_type: ["snippet", "file", "zip", "github"],
      scan_status: ["queued", "running", "completed", "failed"],
      severity_level: ["critical", "high", "medium", "low"],
    },
  },
} as const;
