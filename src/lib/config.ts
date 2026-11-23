/**
 * Límites y constantes de LEAT, centralizados en un solo archivo.
 *
 * Al exceder un límite el escaneo no falla: omite lo sobrante, lo suma a
 * `files_truncated` y queda con `is_full_scan = false`.
 * Valores iniciales según docs/decisiones-tecnicas.md (sección 3.3).
 */

const KB = 1024;
const MB = 1024 * KB;

/** Límites de análisis por archivo y por escaneo. */
export const SCAN_LIMITS = {
  /** Tamaño máximo de un archivo individual que se analiza. */
  maxFileBytes: 1 * MB,
  /** Máximo de archivos analizados por escaneo. */
  maxFilesPerScan: 2_000,
  /** Texto máximo analizado por escaneo (suma de todos los archivos). */
  maxScanTextBytes: 20 * MB,
  /** Longitud máxima de línea que pasa por las regex (prevención de ReDoS). */
  maxLineLength: 2_000,
  /** Bytes iniciales revisados para detectar un byte nulo (archivo binario). */
  binarySniffBytes: 8 * KB,
} as const;

/** Límites de la ingesta de ZIP en el navegador. */
export const ZIP_LIMITS = {
  /** Descompresión total máxima (anti zip bomb). */
  maxUncompressedBytes: 100 * MB,
  /** Relación máxima descomprimido/comprimido por entrada (anti zip bomb). */
  maxCompressionRatio: 100,
  /** Tamaño máximo de cada lote enviado a /api/scans/[id]/chunks (body de Vercel: 4.5 MB). */
  maxChunkBytes: 3 * MB,
  /** Entradas máximas en el directorio del ZIP (protege la memoria al leer el índice). */
  maxEntries: 20_000,
  /** Longitud máxima de la ruta de una entrada. */
  maxPathLength: 1_024,
} as const;

/** Límites del escaneo de repositorios públicos de GitHub. */
export const GITHUB_LIMITS = {
  /** Tamaño máximo del tarball del repositorio. */
  maxRepoBytes: 50 * MB,
  /** Duración máxima de la función en Vercel (segundos); se usa en `maxDuration`. */
  maxDurationSeconds: 300,
  /** Guarda de tiempo: al superarla se detiene el análisis y se marca truncado. */
  timeGuardMs: 240_000,
} as const;

/** Reglas de ciclo de vida de los escaneos. */
export const SCAN_LIFECYCLE = {
  /** Un escaneo `running` sin actividad por más de este tiempo pasa a `failed`. */
  orphanTimeoutMs: 15 * 60 * 1000,
} as const;

/** Rate limit por usuario, contado sobre la tabla `scans`. */
export const RATE_LIMITS = {
  /** Escaneos permitidos por usuario en una ventana de una hora. */
  maxScansPerHour: 10,
  /** Escaneos simultáneos (`queued` o `running`) por usuario. */
  maxConcurrentScans: 2,
} as const;

/** Parámetros del envío de alertas a Discord. */
export const ALERT_LIMITS = {
  /** Reintentos máximos por envío. */
  maxRetries: 3,
  /** Timeout de cada intento HTTP. */
  requestTimeoutMs: 5_000,
  /** Backoff base entre reintentos (se multiplica exponencialmente). */
  backoffBaseMs: 500,
} as const;
