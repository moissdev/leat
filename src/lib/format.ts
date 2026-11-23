/** Formatos de presentación en español (México). */

const TIME_ZONE = "America/Mexico_City";

const dateTime = new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: TIME_ZONE,
});

const number = new Intl.NumberFormat("es-MX");

export function formatDateTime(value: string | Date | null): string {
  if (!value) return "—";
  return dateTime.format(typeof value === "string" ? new Date(value) : value);
}

export function formatNumber(value: number | null | undefined): string {
  return number.format(value ?? 0);
}

/** Duración legible: `850 ms`, `12.4 s`, `3 min 05 s`. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(Math.round(seconds % 60)).padStart(2, "0")} s`;
}

/** Tamaño legible en KB o MB. */
export function formatBytes(bytes: number | null | undefined): string {
  const value = bytes ?? 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
