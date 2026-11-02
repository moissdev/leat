# LEAT: Decisiones técnicas del MVP

Documento complementario a la *Documentación General de LEAT*. Fija el alcance, resuelve las ambigüedades detectadas y sirve de contrato antes de programar.

## 1. Alcance del MVP

| Incluido | Fuera de alcance (declarado como limitación) |
| :-- | :-- |
| Snippet pegado, archivo suelto, ZIP y repositorios **públicos** de GitHub | Repositorios privados de GitHub (fase 2) |
| Análisis del árbol de archivos actual | Historial de commits (un secreto borrado sigue expuesto en el historial) |
| Catálogo fijo de patrones + entropía de Shannon | Reglas personalizadas por usuario |
| Usuario individual con datos aislados | Equipos, roles, organizaciones |
| Informes dentro de la aplicación | Exportación a PDF/JSON |
| Alertas a Discord (webhook propio del usuario) | Otros canales (correo, Slack) |
| Detección temprana | Prevención pre-commit (futuro: CLI o git hook que reutilice el motor) |

Posicionamiento: LEAT es una herramienta de **detección temprana**. No bloquea commits.

## 2. Principio de privacidad

El secreto en texto plano **nunca se persiste ni se registra en logs**. Vive solo en memoria durante el análisis de una request.

- **Enmascarado:** se muestran como máximo 4 caracteres iniciales y 4 finales (`sk_l...7x9Q`). Si el secreto mide menos de 16 caracteres, solo se muestran 2 iniciales y el resto se sustituye por `*`.
- **Contexto de línea:** se guarda la línea con el secreto ya sustituido por su versión enmascarada. Antes de guardar se enmascaran **todos** los secretos de esa línea, no solo el hallazgo actual.
- **Huella (fingerprint):** `HMAC-SHA-256(secreto, pepper)` en hexadecimal. El pepper es una variable de entorno exclusiva del servidor. Un SHA-256 simple se puede atacar por fuerza bruta en secretos de baja entropía; el HMAC con pepper lo evita.
- **Alcance de la deduplicación:** por proyecto, con restricción única `(project_id, fingerprint)`. Nunca global.
- **Visibilidad:** el usuario solo ve la versión enmascarada. La inspección en Monaco muestra el fragmento de código con el secreto ya censurado, no el original.
- **Webhook de Discord:** la URL es un secreto. Se cifra con **AES-256-GCM** en el servidor (clave en variable de entorno, con `key_version` para rotación). El cliente nunca puede leer el texto cifrado.

## 3. Ingesta asíncrona

Un escaneo es un **trabajo con estado**: `queued → running → completed | failed`. La UI muestra el progreso con Supabase Realtime sobre la fila de `scans` (o polling como respaldo) y el usuario puede navegar mientras tanto.

### 3.1 Snippet, archivo y ZIP (orquestado por el cliente)

1. `POST /api/scans` crea el escaneo (`queued`) y devuelve `scan_id`.
2. El cliente descomprime con JSZip, filtra y envía lotes de archivos (≤ ~3 MB por lote) a `POST /api/scans/:id/chunks`. Cada lote se analiza en memoria y se descarta.
3. `POST /api/scans/:id/finalize` cierra el escaneo, evalúa auto-resolución y dispara alertas.

Esto evita el límite de tamaño de body de las funciones serverless y cumple la regla de no almacenar código. Cada lote lleva `chunk_index` para que un reintento no duplique conteos (idempotencia). **Contrapartida:** si el usuario cierra la pestaña a mitad de un ZIP, el escaneo queda incompleto. Un escaneo en `running` sin actividad por más de 15 minutos se marca `failed` (`error_message = 'timeout'`).

Alternativa descartada: subir el ZIP a un bucket temporal y procesarlo en servidor. Es más cómodo para el usuario, pero deja código en reposo, aunque sea brevemente.

### 3.2 GitHub (orquestado por el servidor)

1. `POST /api/scans` valida la URL y crea el escaneo.
2. El trabajo corre en segundo plano en el servidor (`after()` de Next.js o equivalente) y descarga el **tarball/zipball** del repo en una sola petición, en streaming, en lugar de leer archivo por archivo con la API de contenidos.
3. Se usa un token de GitHub **de la aplicación** (solo lectura de repos públicos) para tener 5,000 req/h en lugar de 60. Ese token vive en variable de entorno, nunca en el cliente.
4. Se guarda el `commit SHA` analizado en `scans.source_ref`.

Los límites exactos de duración y memoria de las funciones dependen del plan de hosting; hay que verificarlos al desplegar y ajustar las constantes de la sección 3.3.

### 3.3 Límites (constantes configurables en un solo archivo)

| Constante | Valor inicial |
| :-- | :-- |
| Tamaño máximo por archivo | 1 MB |
| Máximo de archivos por escaneo | 2,000 |
| Texto máximo analizado por escaneo | 20 MB |
| Tamaño máximo de repo (zipball) | 50 MB |
| Longitud máxima de línea analizada | 2,000 caracteres |
| Descompresión máxima ZIP (anti zip bomb) | 100 MB descomprimidos y relación de compresión acotada |

Si se excede un límite, el escaneo **no falla**: omite lo que sobra, lo registra en `files_truncated` y se marca `is_full_scan = false`.

### 3.3.1 Plataforma de despliegue: Vercel Hobby

| Dato | Valor | Estado |
| :-- | :-- | :-- |
| Plan | Hobby | Confirmado |
| Funciones por deployment | Next.js las agrupa; el tope de 12 no aplica | Confirmado en la documentación de Vercel |
| CPU activa (Fluid) | 4 h/mes | Confirmado en el panel *Usage* |
| Invocaciones de funciones | 1 M/mes | Confirmado en el panel *Usage* |
| Token de GitHub de la aplicación | 5,000 req/h | Confirmado |
| Duración máxima de función | 300 s con Fluid compute | **Por verificar** en la página *Limits* de Vercel |
| Memoria por función | 2 GB | **Por verificar** |
| Tamaño máximo del body de una request | 4.5 MB | **Por verificar** |

El valor *Proxied Request Timeout* (120 s) de la tabla de límites aplica a peticiones que Vercel reenvía a un origen externo; no es la duración de una función y no afecta a LEAT.

Decisiones derivadas:

- **Lotes de ZIP ≤ 3 MB**, por debajo del límite de body de 4.5 MB.
- **Ruta del escaneo de GitHub** con `export const maxDuration = 300` y **guarda de tiempo**: si el análisis supera ~240 s, se detiene, se registra el resto en `files_truncated` y el escaneo termina con `is_full_scan = false`, en lugar de que la plataforma lo corte a la mitad.
- **Presupuesto de CPU:** 4 h/mes alcanza de sobra para un proyecto académico (un escaneo típico consume segundos), pero conviene evitar bucles de re-escaneo en pruebas. El rate limiting por usuario también protege esta cuota.
- **Escaneos huérfanos** (en `running` más de 15 minutos): no depender de Vercel Cron en el plan Hobby, cuya frecuencia permitida hay que verificar. Se marcan como `failed` de forma perezosa al listar escaneos y, opcionalmente, con `pg_cron` en Supabase.

### 3.4 Archivos ignorados

Directorios: `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `vendor/`, `__pycache__/`.
Archivos: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `*.min.js`, `*.map`, binarios (extensión conocida o byte nulo en los primeros 8 KB), imágenes, fuentes.

## 4. Motor de detección

Módulo aislado y testeable, sin dependencias de Next.js ni de Supabase.

### 4.1 Catálogo fijo de patrones y severidad

| Patrón | Severidad |
| :-- | :-- |
| AWS Access Key (`AKIA…`/`ASIA…`) y Secret Key con contexto | Crítica |
| Stripe live (`sk_live_`, `rk_live_`) | Crítica |
| Claves privadas PEM (`-----BEGIN … PRIVATE KEY-----`) | Crítica |
| Connection strings con credenciales (`postgres://user:pass@…`, `mongodb+srv://…`) | Crítica |
| JWT de Supabase con `role: service_role` | Crítica |
| GitHub tokens (`ghp_`, `github_pat_`, `gho_`) | Alta |
| Slack tokens (`xox[baprs]-`) | Alta |
| Google API key (`AIza…`), SendGrid (`SG.…`), Twilio | Alta |
| JWT genérico, Stripe test (`sk_test_`) | Media |
| Entropía alta **con** contexto (`key`, `secret`, `token`, `password`, `pwd`, `auth` en el nombre de la variable) | Media |
| Entropía alta **sin** contexto | Baja |

Los formatos exactos de cada proveedor deben contrastarse con su documentación al implementar las regex.

### 4.2 Entropía de Shannon

- Longitud mínima del candidato: 20 caracteres.
- Umbral por conjunto de caracteres: hexadecimal ≈ 3.0, base64/alfanumérico ≈ 4.2.
- Se excluyen UUIDs, hashes de lockfiles y datos base64 incrustados (`data:image/...`).
- Los candidatos con contexto de nombre de variable suben de severidad (tabla anterior).

### 4.3 Prevención de ReDoS

Regex sin cuantificadores anidados, longitud de línea limitada (sección 3.3) y pruebas con entradas patológicas. No se aceptan regex del usuario.

## 5. Ciclo de vida de hallazgos

Un **hallazgo** (`findings`) es un secreto único dentro de un proyecto. Sus **ocurrencias** (`finding_occurrences`) son los lugares donde apareció (archivo y línea), por escaneo.

- Hallazgo nuevo: se crea `Activa`.
- Re-detección: se agrega ocurrencia y se actualiza `last_detected_at`. Si estaba `Resuelta`, **se reabre** a `Activa` (actor `system`).
- Estados `Ignorada` y `Falso Positivo`: los fija el usuario; no se reabren solos.
- **Auto-resolución:** al finalizar un escaneo con `is_full_scan = true` (ZIP o GitHub) de un proyecto, los hallazgos `Activa` cuya huella no apareció pasan a `Resuelta` (actor `system`, motivo `no_longer_detected`). Los escaneos de snippet o archivo suelto **nunca** auto-resuelven.
- **TTR (Time-to-remediate):** `resolved_at − first_detected_at`, registrado en el log de transición.

## 6. Score

Por proyecto, sobre hallazgos en estado `Activa`:

```
score = max(0, 100 − (25·críticas + 10·altas + 4·medias + 1·bajas))
```

Score global del dashboard = promedio de los scores de los proyectos del usuario. La fórmula vive en la vista SQL `project_score_v`, de modo que dashboard e informes usan la misma definición.

## 7. Alertas a Discord

- Disparo: hallazgos **nuevos o reabiertos** con severidad Alta o Crítica (no se reenvía lo ya alertado).
- Envío *best-effort* con timeout corto y hasta 3 reintentos con backoff. No bloquea el cierre del escaneo.
- Cada intento queda en `alert_logs` (código HTTP, éxito, error).
- Un embed por escaneo agrupa los hallazgos (se evita inundar el canal). Color por severidad: coral para Crítica, ámbar para Alta.
- El payload usa solo datos enmascarados.

## 8. Informes y auditoría (requisito de la materia)

Los informes se construyen desde las tablas de logs y vistas, sin exportación:

| Informe | Fuente |
| :-- | :-- |
| Historial de escaneos y detalle de cada uno (duración, archivos, hallazgos nuevos) | `scans`, `scan_logs`, `scan_report_v` |
| Listado de hallazgos con filtros (severidad, estado, tipo, proyecto) | `findings`, `finding_occurrences` |
| Línea de tiempo de cada hallazgo y TTR | `vulnerability_lifecycle_logs`, `ttr_summary_v` |
| Entregas de alertas | `alert_logs` |

Los tres dominios de log son **append-only**: el usuario puede leerlos pero no modificarlos ni borrarlos.

## 9. Seguridad de la propia herramienta

| Riesgo | Mitigación |
| :-- | :-- |
| Acceso a datos de otros usuarios | RLS en todas las tablas por `user_id`; las políticas están en el esquema SQL |
| Escritura del motor con `service_role` (omite RLS) | Módulo solo de servidor; `user_id` siempre sale de la sesión verificada, nunca del body; toda consulta filtra explícitamente por `user_id` |
| SSRF y URLs maliciosas | Solo `github.com`; `owner` y `repo` validados con regex estricta antes de llamar a la API |
| Zip bomb / zip slip | Límites de descompresión (sección 3.3) y rechazo de rutas con `..` o absolutas |
| Abuso de endpoints | Rate limiting por usuario en `/api/scans*` |
| ReDoS | Sección 4.3 |
| Secretos en logs | Prohibido registrar contenido de archivos o secretos; los logs solo llevan metadatos |
| Webhook expuesto | Cifrado en reposo; columnas sin permiso de lectura para el cliente |

## 10. Ajustes al stack

| Original | Ajuste | Motivo |
| :-- | :-- | :-- |
| Monaco **y** Prism.js | Solo Monaco, con `dynamic import` y `ssr: false` | Funciones solapadas; Monaco pesa bastante |
| Tremor **y** Recharts | Tremor para dashboard; Recharts solo si se necesita algo a medida | Tremor ya usa Recharts internamente |
| Acrónimo con T = *Tool* y coral = *Threat* | Unificar: T = *Threat* en la identidad visual | Evita inconsistencia en la documentación |
| Pruebas no mencionadas | Vitest para el motor | Es el módulo crítico |

## 11. Estructura de carpetas sugerida

```
src/
  lib/
    engine/            # sin dependencias de Next ni Supabase
      patterns.ts      # catálogo y severidades
      entropy.ts
      mask.ts
      fingerprint.ts   # HMAC
      scanner.ts       # orquesta regex + entropía
      __tests__/       # fixtures de verdaderos y falsos positivos
    ingest/            # zip, github, filtros y límites
    alerts/            # discord.ts, crypto.ts (AES-GCM)
    supabase/          # cliente de usuario y cliente service_role (solo servidor)
    config.ts          # constantes de límites
  app/
    api/scans/...
    (dashboard)/...
supabase/
  migrations/001_schema.sql
```

## 12. Orden de implementación

1. Proyecto base (Next.js, Tailwind, Supabase Auth) y migración `001_schema.sql`.
2. **Motor de detección con pruebas unitarias** (antes de cualquier UI).
3. Ingesta: snippet → archivo → ZIP → GitHub.
4. API de escaneos (crear, lotes, finalizar), auto-resolución y log de eventos.
5. Alertas a Discord y configuración del webhook.
6. UI: dashboard, inspección en Monaco, gestión de estados.
7. Informes (escaneos, hallazgos, línea de tiempo, alertas).
8. Endurecimiento: rate limiting, pruebas de zip bomb y ReDoS, revisión de RLS.
