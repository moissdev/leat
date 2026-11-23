# LEAT · Leak & Exposure Assessment Tool

Plataforma web de análisis estático (SAST) que **detecta secretos filtrados en código fuente**: API keys, tokens, credenciales, claves privadas y connection strings. Analiza un fragmento pegado, un archivo, un ZIP o un repositorio público de GitHub; enmascara cada hallazgo, le da seguimiento en el tiempo y avisa a Discord cuando aparece algo grave.

**Despliegue:** https://leat-two.vercel.app

> Proyecto de la materia de Ciberseguridad. Problema: la filtración de secretos en el código de los desarrolladores. LEAT es una herramienta de **detección temprana**; no bloquea commits.

---

## Contenido

- [Funcionalidades](#funcionalidades)
- [Cómo funciona](#cómo-funciona)
- [Privacidad y seguridad](#privacidad-y-seguridad)
- [Arquitectura](#arquitectura)
- [Instalación local](#instalación-local)
- [Variables de entorno](#variables-de-entorno)
- [Pruebas](#pruebas)
- [Despliegue en Vercel](#despliegue-en-vercel)
- [Límites](#límites)
- [Alcance y riesgos conocidos](#alcance-y-riesgos-conocidos)
- [Documentación](#documentación)

---

## Funcionalidades

- **Cuatro formas de escanear:** fragmento pegado, archivo suelto, ZIP (se descomprime en el navegador) y repositorio público de GitHub (lo procesa el servidor).
- **Motor híbrido:** catálogo fijo de patrones con severidad + entropía de Shannon para secretos sin firma conocida.
- **Proyectos y score:** cada proyecto tiene un score de 0 a 100 según sus hallazgos activos; el dashboard muestra el promedio, la distribución por severidad y la tendencia de los últimos 30 días.
- **Ciclo de vida de hallazgos:** Activa, Resuelta, Ignorada y Falso positivo, con reapertura y auto-resolución automáticas y un historial de auditoría por hallazgo.
- **Inspección segura:** visor Monaco en solo lectura que muestra la línea con el secreto ya censurado.
- **Progreso en vivo:** Supabase Realtime sobre la fila del escaneo, con polling de respaldo.
- **Alertas a Discord:** un mensaje por escaneo con los hallazgos Alta o Crítica nuevos o reabiertos; webhook cifrado, reintentos y registro de cada entrega.
- **Informes:** historial de escaneos, bitácora de cada uno, tiempo medio de remediación (TTR) por severidad, entregas de alertas y actividad del log de auditoría.

## Cómo funciona

### Motor de detección

Módulo puro en `src/lib/engine/` (sin dependencias de Next ni de Supabase).

| Severidad | Patrones |
| :-- | :-- |
| **Crítica** | AWS Access Key y Secret Key (con contexto), Stripe live, claves privadas PEM, connection strings con contraseña, JWT de Supabase con rol `service_role` |
| **Alta** | Tokens de GitHub (clásicos y de grano fino), Slack, Google API key, SendGrid, Twilio |
| **Media** | JWT genérico, Stripe de pruebas, alta entropía **con** nombre de variable sensible (`key`, `secret`, `token`, `password`, `pwd`, `auth`) |
| **Baja** | Alta entropía **sin** contexto |

- **Entropía:** candidatos de 20+ caracteres con umbral de 3.0 bits/carácter para hexadecimal y 4.2 para base64/alfanumérico. Excluye UUIDs, hashes de lockfiles, URIs `data:`, ETags, referencias de git fijadas, hex que es texto o datos comprimidos, y segmentos cortos de URLs.
- **Sin ReDoS:** regex sin cuantificadores anidados y líneas limitadas a 2,000 caracteres; probado con fuzzing.
- **Filtros:** se omiten `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `vendor/`, `__pycache__/`, lockfiles, archivos minificados, mapas y binarios.

### Ciclo de vida

- Un **hallazgo** es un secreto único por proyecto (por su huella); cada aparición es una **ocurrencia** por escaneo.
- Un hallazgo nuevo nace **Activa**. Si un hallazgo **Resuelta** vuelve a aparecer, se **reabre** solo.
- **Ignorada** y **Falso positivo** los decide el usuario y no se reabren solos.
- Un escaneo **completo** de ZIP o GitHub **auto-resuelve** los hallazgos activos que ya no aparecen. Fragmentos y archivos sueltos nunca auto-resuelven.
- Cada transición queda en el log de auditoría (lo escribe un trigger de la base), con el TTR al resolver.

### Score

```
score del proyecto = max(0, 100 − (25·críticas + 10·altas + 4·medias + 1·bajas))   (solo hallazgos activos)
score global       = promedio de los scores de los proyectos
```

La fórmula vive en la vista SQL `project_score_v`, que comparten el dashboard y los informes.

## Privacidad y seguridad

- **El secreto en texto plano nunca se guarda, se registra ni sale del motor.** Vive solo en memoria durante la petición.
- **Enmascarado:** como máximo 4 caracteres al inicio y 4 al final (`sk_l...7x9Q`); con menos de 16 caracteres, 2 iniciales y el resto `*`; con 4 o menos, todo `*`. La línea de contexto se guarda con **todos** sus secretos enmascarados.
- **Huella:** `HMAC-SHA-256(secreto, pepper)`; el pepper es una variable de entorno del servidor.
- **Webhook de Discord:** cifrado con AES-256-GCM (IV aleatorio, `user_id` como dato asociado, versión de clave para rotación). El cliente nunca puede leerlo.
- **Aislamiento por usuario:** RLS en todas las tablas. La clave `service_role` solo existe en módulos de servidor (`server-only`) y el `user_id` sale siempre de la sesión verificada, nunca del body.
- **Logs append-only** para el usuario; solo contienen metadatos.
- **Entradas validadas con zod.** URLs de GitHub y de Discord con validación estricta (anti SSRF); descompresión protegida contra zip slip y zip bomb.
- **Cabeceras HTTP:** `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS y una CSP parcial.
- **Auditoría (checkpoint 21):** RLS probado con dos cuentas en todas las tablas y vistas, rate limit, zip bomb, ReDoS, ausencia de secretos en la base y en los logs, `npm audit` sin vulnerabilidades y **LEAT escanea su propio repositorio con cero hallazgos** (prueba permanente).

## Arquitectura

**Stack:** Next.js 16 (App Router), React 19, TypeScript estricto, Tailwind CSS 4, Supabase (Postgres, Auth, Realtime), Recharts, Monaco, JSZip, tar-stream, Octokit, zod y Vitest. Desplegado en Vercel.

```
Navegador ──► POST /api/scans ─────────────► crea el escaneo (queued)
   │   ZIP: JSZip + filtros + lotes ≤ 3 MB
   ├─────────► POST /api/scans/[id]/chunks ─► motor en memoria ─► hallazgos enmascarados
   └─────────► POST /api/scans/[id]/finalize► cierre, auto-resolución, alertas (after())

GitHub: POST /api/scans ─► after(): metadatos + tarball en streaming ─► mismo núcleo de lotes
UI ◄── Supabase Realtime (fila de scans) + polling de respaldo
```

```
src/
├── app/                 rutas: (auth) login/registro, (app) secciones, api/
├── components/          ui/ (base), layout/, dashboard/, projects/, scans/, findings/, reports/, settings/
├── hooks/               progreso de escaneo en vivo
├── lib/
│   ├── engine/          motor PURO: patrones, entropía, máscara, huella, filtros, escáner
│   ├── ingest/          validación de URLs, ZIP en el navegador, GitHub en el servidor, orquestador
│   ├── scans/           crear, procesar lotes, finalizar, auto-resolución, limpieza, rate limit
│   ├── alerts/          cifrado, embed de Discord, envío con reintentos
│   ├── projects/ findings/ reports/ dashboard/ settings/   consultas y acciones por sección
│   ├── supabase/        clientes: navegador, servidor (RLS) y admin (server-only)
│   └── config.ts        límites configurables
supabase/migrations/     001 esquema · 002 permisos de triggers · 003 idempotencia de lotes · 004 Realtime
tests/                   unitarias, integración (tests/db) y seguridad (tests/security)
```

## Instalación local

### Requisitos

- Node.js 24 y npm.
- Un proyecto de [Supabase](https://supabase.com).
- Un token de GitHub de **solo lectura de repositorios públicos** (fine-grained token, sin permisos adicionales).
- Opcional: un webhook de Discord para las alertas.

### Pasos

1. **Clona e instala dependencias**

   ```bash
   git clone https://github.com/moissdev/leat.git
   cd leat
   npm install
   ```

2. **Aplica las migraciones** en el SQL Editor de Supabase, **en orden**:

   ```
   supabase/migrations/001_schema.sql
   supabase/migrations/002_revoke_trigger_functions.sql
   supabase/migrations/003_scan_chunk_idempotency.sql
   supabase/migrations/004_realtime_scans.sql
   ```

   `supabase/manual/rls_two_users.sql` es una prueba manual de RLS con dos usuarios; termina en `ROLLBACK` y no deja cambios.

3. **Configura la autenticación de Supabase** (*Authentication → URL Configuration*):
   - **Site URL:** `http://localhost:3000` (o la URL de producción).
   - **Redirect URLs:** `http://localhost:3000/**` y la de producción.
   - Plantilla del correo de confirmación (*Email Templates → Confirm signup*), enlace:

     ```
     {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
     ```

4. **Crea `.env.local`** a partir de `.env.example` y llena los valores (ver la tabla siguiente). Para generar el pepper y la clave de cifrado:

   ```bash
   openssl rand -hex 32      # LEAT_FINGERPRINT_PEPPER
   openssl rand -base64 32   # LEAT_WEBHOOK_ENCRYPTION_KEY
   ```

5. **Arranca el servidor de desarrollo**

   ```bash
   npm run dev
   ```

   Abre http://localhost:3000, crea una cuenta, confirma el correo, crea un proyecto y lanza tu primer escaneo.

## Variables de entorno

Nunca se versionan: van en `.env.local` y en las variables del proyecto de Vercel.

| Variable | Uso | Expuesta al navegador |
| :-- | :-- | :-- |
| `NEXT_PUBLIC_SUPABASE_URL` | Origen del proyecto de Supabase (`https://<ref>.supabase.co`, sin ruta) | Sí |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública (`sb_publishable_…`) | Sí |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave secreta del servidor (`sb_secret_…`); omite RLS | **No** |
| `LEAT_FINGERPRINT_PEPPER` | Pepper del HMAC de las huellas (32+ caracteres) | **No** |
| `LEAT_WEBHOOK_ENCRYPTION_KEY` | Clave AES-256-GCM del webhook (32 bytes: hex, base64 o 32 caracteres ASCII) | **No** |
| `LEAT_GITHUB_TOKEN` | Token de la aplicación para repos públicos de GitHub | **No** |

> Cambiar `LEAT_FINGERPRINT_PEPPER` cambia todas las huellas: los secretos ya registrados se verían como nuevos.

## Pruebas

| Comando | Qué hace |
| :-- | :-- |
| `npm test` | Pruebas unitarias y de seguridad (motor, ingesta, escaneos con persistencia en memoria, alertas, API, informes, cabeceras, auto-escaneo del repositorio). Sin red ni base de datos. |
| `npm run test:db` | Integración contra el Supabase de **desarrollo** (lee `.env.local`): crea usuarios temporales `@example.com`, ejercita RLS, triggers, vistas, GitHub y alertas, y los borra al terminar. |
| `npm run typecheck` | Tipos de rutas de Next + `tsc --noEmit` (TypeScript estricto, sin `any`). |
| `npm run lint` | ESLint. |
| `npm run build` | Build de producción. |

Los secretos de las pruebas son **falsos** y se arman en tiempo de ejecución concatenando fragmentos (`tests/fixtures/secrets.ts`), para que no disparen la protección de push de GitHub ni al propio LEAT.

## Despliegue en Vercel

1. Importa el repositorio en Vercel con el preset **Next.js** y la rama de producción `main`.
2. Agrega las seis variables de entorno (Production y Preview); marca como *Sensitive* las que no son públicas.
3. En Supabase, agrega la URL de Vercel a **Site URL** y **Redirect URLs**.
4. Verifica: `https://<tu-dominio>/api/health` responde `{"status":"ok",…}` con el commit desplegado.

El escaneo de GitHub corre en segundo plano con `after()` y `maxDuration = 300` s, con una guarda de tiempo de ~240 s.

## Límites

Configurables en `src/lib/config.ts`. Al excederlos **el escaneo no falla**: omite lo sobrante y queda marcado como cobertura parcial.

| Límite | Valor |
| :-- | :-- |
| Tamaño por archivo | 1 MB |
| Archivos por escaneo | 2,000 |
| Texto analizado por escaneo | 20 MB |
| Tamaño del repositorio (tarball) | 50 MB |
| Longitud de línea analizada | 2,000 caracteres |
| Descompresión de ZIP | 100 MB, relación de compresión ≤ 100 |
| Lote enviado al servidor | ≤ 3 MB |
| Guarda de tiempo de GitHub | ~240 s (función de 300 s) |
| Escaneo sin actividad | > 15 min → fallido |
| Rate limit por usuario | 10 escaneos por hora, 2 en curso |

## Alcance y riesgos conocidos

**Fuera del alcance del MVP:** repositorios privados, historial de commits, hooks pre-commit o CLI, reglas personalizadas, equipos y roles, exportación de informes y otros canales de alerta.

**Riesgos residuales documentados en la auditoría:**

- Los conteos de archivos omitidos que reporta el cliente deciden si un escaneo es completo; un cliente modificado podría auto-resolver **sus propios** hallazgos. RLS impide afectar a otros usuarios.
- La CSP no restringe `script-src`: hacerlo exige nonces en Next y una excepción para el CDN de Monaco.
- Monaco se carga desde jsDelivr en una versión fijada; el visor es de solo lectura y solo recibe texto ya enmascarado.

## Documentación

- [`docs/decisiones-tecnicas.md`](docs/decisiones-tecnicas.md): decisiones del MVP, catálogo de patrones, severidades, score, alertas y seguridad.
- [`docs/documentacion-general.md`](docs/documentacion-general.md): documento original de la idea.
- [`supabase/migrations/001_schema.sql`](supabase/migrations/001_schema.sql): modelo de datos, RLS, triggers y vistas.
- [`CLAUDE.md`](CLAUDE.md): reglas de trabajo, checkpoints y convenciones del proyecto.
