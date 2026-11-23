# CLAUDE.md — LEAT: Leak & Exposure Assessment Tool (Ciberseguridad)

## Qué es este proyecto
Plataforma web DevSecOps de análisis estático (SAST) enfocada en **detectar secretos** (API keys, tokens, credenciales, claves privadas, connection strings) filtrados en código fuente. El usuario aporta código (snippet, archivo, ZIP o repositorio público de GitHub); un motor híbrido (**regex + entropía de Shannon**) lo analiza; cada hallazgo se enmascara, se hashea y entra a un ciclo de vida (Activa, Resuelta, Ignorada, Falso positivo) con alertas a Discord e informes de auditoría. Proyecto para la materia de Ciberseguridad (problema: filtración de secretos en el código de los desarrolladores).

LEAT es una herramienta de **detección temprana**; no bloquea commits (la prevención pre-commit queda fuera del MVP).

Fuentes de verdad (léelas bajo demanda; no las importes con `@`):
- `docs/decisiones-tecnicas.md`: decisiones del MVP, límites, catálogo de patrones, severidades, score, alertas y seguridad.
- `supabase/migrations/001_schema.sql`: modelo de datos, RLS, triggers y vistas.
- `docs/documentacion-general.md`: documento original de la idea (visión y contexto).

Precedencia: para **comportamiento y datos**, gana `decisiones-tecnicas.md` y el SQL sobre la documentación general. Para **estructura de carpetas y flujo de trabajo**, gana este archivo sobre el esbozo de la sección 11 de las decisiones.

## Usuario
Moisés, estudiante de último año de Ing. en Software (México). Fuerte en frontend y UI/UX. Responder en español; identificadores de código en inglés; comentarios y docstrings en español. La interfaz de la aplicación va en español (ver `lib/i18n/labels.ts`); los enums de base de datos y del código quedan en inglés.

## Decisiones cerradas (no reabrir sin que el usuario lo pida)

**Alcance del MVP**
- Entradas: snippet pegado, archivo suelto, ZIP y repositorios **públicos** de GitHub. Solo el árbol de archivos actual (sin historial de commits).
- Catálogo **fijo** de patrones (sin reglas personalizadas). Usuario individual con datos aislados (sin equipos ni roles). Sin exportación de informes: todo se ve en la aplicación.
- Fuera de alcance: repos privados, historial de commits, pre-commit/CLI, otros canales de alerta.

**Privacidad (innegociable)**
- El secreto en texto plano **nunca** se persiste, se registra en logs ni sale del motor: solo viven en memoria durante la request.
- Enmascarado: máximo 4 caracteres iniciales y 4 finales (`sk_l...7x9Q`); si mide menos de 16, 2 iniciales y el resto `*`. El contexto de línea se guarda con **todos** los secretos de esa línea ya enmascarados.
- Huella: `HMAC-SHA-256(secreto, pepper)` en hex; el pepper es variable de entorno del servidor. Deduplicación por proyecto: `unique (project_id, fingerprint)`.
- El usuario solo ve la versión enmascarada. Monaco muestra el contexto ya censurado, en solo lectura.
- Webhook de Discord: configurable por usuario y cifrado en reposo con AES-256-GCM (clave en variable de entorno, `key_version` para rotación). El cliente nunca lee el texto cifrado.

**Ingesta asíncrona** (un escaneo es un trabajo: `queued → running → completed | failed`; la UI sigue el progreso con Supabase Realtime sobre `scans`, con polling de respaldo)
- Snippet, archivo y ZIP: el **cliente** orquesta. `POST /api/scans` crea el escaneo; el cliente (JSZip) descomprime, filtra y envía lotes ≤ 3 MB a `POST /api/scans/[id]/chunks`; `POST /api/scans/[id]/finalize` cierra. Cada lote lleva `chunk_index` (idempotencia vía `scan_logs`). El código se analiza en memoria y se descarta.
- GitHub: el **servidor** descarga el tarball del repo en streaming y lo procesa en segundo plano (`after()` de `next/server` o la alternativa vigente en la versión instalada). Token de GitHub **de la aplicación** (solo lectura, repos públicos). Se guarda el commit SHA en `scans.source_ref`.
- Límites configurables en un solo archivo (`src/lib/config.ts`). Al excederlos el escaneo **no falla**: omite lo sobrante, lo suma a `files_truncated` y queda `is_full_scan = false`.

| Constante | Valor inicial |
| :-- | :-- |
| Tamaño máximo por archivo | 1 MB |
| Máximo de archivos por escaneo | 2,000 |
| Texto máximo analizado por escaneo | 20 MB |
| Tamaño máximo de repo (tarball) | 50 MB |
| Longitud máxima de línea analizada | 2,000 caracteres |
| Descompresión máxima de ZIP | 100 MB y relación de compresión acotada |
| Lote de ZIP | ≤ 3 MB |
| Ruta de GitHub | `maxDuration = 300` s; guarda de tiempo a ~240 s |
| Escaneo huérfano (`running` sin actividad) | > 15 min → `failed` (limpieza perezosa al listar) |
| Rate limit por usuario | ≤ 10 escaneos/hora y ≤ 2 en curso (se cuenta sobre `scans`, sin infraestructura extra) |

Por verificar en la página *Limits* de Vercel (Hobby, confirmado): duración máxima 300 s, memoria 2 GB, body 4.5 MB. Si alguno difiere, solo se ajusta la constante correspondiente.

**Motor de detección** (módulo puro, sin dependencias de Next ni de Supabase)
- Catálogo con severidad por patrón (sección 4.1 de las decisiones): Crítica (AWS, Stripe live, PEM, connection strings, Supabase `service_role`), Alta (GitHub, Slack, Google, SendGrid, Twilio), Media (JWT genérico, Stripe test, entropía con contexto), Baja (entropía sin contexto).
- Entropía: longitud mínima 20; umbral hex ≈ 3.0 y base64/alfanumérico ≈ 4.2; excluye UUIDs, hashes de lockfiles y `data:` base64. El nombre de variable con contexto (`key`, `secret`, `token`, `password`, `pwd`, `auth`) sube la severidad.
- Archivos ignorados: `node_modules/`, `.git/`, `dist/`, `build/`, `.next/`, `vendor/`, `__pycache__/`, lockfiles, `*.min.js`, `*.map`, binarios (extensión o byte nulo en los primeros 8 KB).
- Sin ReDoS: regex sin cuantificadores anidados y línea limitada. No se aceptan regex del usuario.

**Ciclo de vida y score**
- Hallazgo = secreto único por proyecto (`findings`); ocurrencias por escaneo (`finding_occurrences`).
- Nuevo → `active`. Re-detección: nueva ocurrencia y `last_detected_at`; si estaba `resolved`, se **reabre** a `active` (actor `system`). `ignored` y `false_positive` no se reabren solos.
- Auto-resolución: solo al finalizar un escaneo con `is_full_scan = true` de tipo `zip` o `github`; los `active` cuya huella no apareció pasan a `resolved` (actor `system`, motivo `no_longer_detected`). Snippet y archivo suelto **nunca** auto-resuelven.
- Los triggers del SQL escriben el log de transición y el TTR; la aplicación no duplica esa lógica.
- Score por proyecto: `max(0, 100 − (25·críticas + 10·altas + 4·medias + 1·bajas))` sobre hallazgos `active` (vista `project_score_v`); el global es el promedio de proyectos.

**Alertas (Discord)**
- Solo hallazgos **nuevos o reabiertos** con severidad Alta o Crítica. Un embed por escaneo, con color por severidad y solo datos enmascarados.
- Envío *best-effort*, timeout corto, hasta 3 reintentos con backoff; no bloquea el cierre del escaneo; cada intento va a `alert_logs`.

**Acceso a datos y seguridad**
- RLS en todas las tablas por `user_id`. El usuario solo puede: gestionar sus proyectos, cambiar `status` y `status_note` de sus hallazgos y activar/desactivar alertas. Todo lo demás lo escribe el motor con `service_role`.
- `service_role` **omite RLS**: vive solo en módulos de servidor (`import "server-only"`), el `user_id` sale **siempre** de la sesión verificada (nunca del body) y toda consulta filtra explícitamente por `user_id`.
- Entradas validadas con `zod`. URL de GitHub: solo `https://github.com/<owner>/<repo>`, con regex estricta, sin credenciales, puertos ni rutas con `..`. Descompresión: rechazar rutas absolutas o con `..` (zip slip) y respetar los límites (zip bomb).
- Prohibido registrar contenido de archivos o secretos en logs, errores o respuestas de la API. Sin `dangerouslySetInnerHTML`.
- Los logs (`scan_logs`, `vulnerability_lifecycle_logs`, `alert_logs`) son append-only para el usuario.

**Interfaz**
- Modo oscuro de estética ciberseguridad. Identidad cromática del acrónimo: cian = **L** (*Leak*), púrpura = **EA** (*Assessment*), coral/rojo = **T** (*Threat*).
- Estados y severidades visibles en español: Activa, Resuelta, Ignorada, Falso positivo; Crítica, Alta, Media, Baja.
- El diseño visual es el fuerte del usuario: proponer paleta y componentes base y **esperar su validación** antes de aplicarlos a toda la UI.

## Stack y dependencias permitidas
Next.js (App Router, `src/`), React, TypeScript en modo `strict` (sin `any`), Tailwind CSS, Supabase (`@supabase/supabase-js`, `@supabase/ssr`), `@monaco-editor/react` (con `dynamic import` y `ssr: false`), `lucide-react`, `@tremor/react` (Recharts solo si hace falta algo a medida), `jszip`, `tar-stream`, `@octokit/rest` (metadatos del repo: rama por defecto, commit SHA, tamaño), `zod`, `server-only`, Vitest. Gestor de paquetes: npm.

- Antes de instalar Tremor, comprobar su compatibilidad con las versiones de React y Tailwind del scaffold; si no es compatible, usar Recharts directo y avisar.
- Cualquier dependencia fuera de esta lista se consulta con el usuario.
- El motor (`src/lib/engine/`) usa solo la biblioteca estándar de Node/TypeScript (`node:crypto` para HMAC); el pepper llega como parámetro.

## Variables de entorno
Nombres versionados en `.env.example` (sin valores). Los valores reales los genera y coloca el usuario en `.env.local` y en Vercel; **Claude Code nunca lee, imprime ni inventa valores reales**.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
LEAT_FINGERPRINT_PEPPER=
LEAT_WEBHOOK_ENCRYPTION_KEY=
LEAT_GITHUB_TOKEN=
```

Solo la URL y la clave anónima de Supabase pueden tener prefijo `NEXT_PUBLIC_`.

## Estructura
```
leat/
├── CLAUDE.md
├── README.md
├── .gitignore
├── .env.example
├── package.json  tsconfig.json  next.config.ts  vitest.config.ts  eslint.config.mjs
├── docs/
│   ├── documentacion-general.md
│   └── decisiones-tecnicas.md
├── supabase/
│   └── migrations/
│       └── 001_schema.sql              # ya aplicada = inmutable; cambios en 002_*.sql
├── src/
│   ├── middleware.ts                   # protege rutas de la app (sesión Supabase)
│   ├── app/
│   │   ├── layout.tsx  globals.css
│   │   ├── (auth)/login/page.tsx
│   │   ├── (auth)/signup/page.tsx
│   │   ├── (app)/
│   │   │   ├── layout.tsx              # barra lateral + cabecera
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── projects/page.tsx
│   │   │   ├── projects/[id]/page.tsx
│   │   │   ├── scans/new/page.tsx
│   │   │   ├── scans/[id]/page.tsx
│   │   │   ├── findings/page.tsx
│   │   │   ├── findings/[id]/page.tsx  # inspección con Monaco (solo lectura)
│   │   │   ├── reports/page.tsx        # historial de escaneos, TTR, alertas
│   │   │   └── settings/page.tsx       # webhook de Discord
│   │   └── api/
│   │       ├── health/route.ts
│   │       ├── scans/route.ts                  # POST: crear escaneo
│   │       ├── scans/[id]/chunks/route.ts      # POST: lote de archivos
│   │       ├── scans/[id]/finalize/route.ts    # POST: cerrar escaneo
│   │       └── settings/webhook/route.ts       # PUT, DELETE y prueba de envío
│   ├── lib/
│   │   ├── config.ts                   # límites y constantes
│   │   ├── i18n/labels.ts              # etiquetas en español de estados y severidades
│   │   ├── engine/                     # PURO: sin Next ni Supabase
│   │   │   ├── types.ts  patterns.ts  entropy.ts  mask.ts
│   │   │   ├── fingerprint.ts  filters.ts  scanner.ts  index.ts
│   │   ├── ingest/
│   │   │   ├── github-url.ts           # validación estricta de la URL
│   │   │   ├── zip-client.ts           # navegador: JSZip, filtros, lotes, zip slip/bomb
│   │   │   └── github.ts               # servidor: tarball en streaming, guarda de tiempo
│   │   ├── scans/                      # lógica de negocio del escaneo
│   │   │   ├── create.ts  process-chunk.ts  finalize.ts
│   │   │   ├── persist.ts              # puerto de persistencia (interfaz) + impl. Supabase
│   │   │   ├── auto-resolve.ts  cleanup.ts  rate-limit.ts
│   │   ├── alerts/
│   │   │   ├── crypto.ts               # AES-256-GCM del webhook
│   │   │   ├── discord.ts              # construcción del embed
│   │   │   └── dispatch.ts             # envío, reintentos y alert_logs
│   │   └── supabase/
│   │       ├── browser.ts  server.ts   # con sesión del usuario (RLS)
│   │       └── admin.ts                # service_role, "server-only"
│   ├── components/
│   │   ├── ui/  layout/  dashboard/  scans/  findings/  reports/
│   ├── hooks/                          # p. ej. progreso de escaneo (Realtime)
│   └── types/database.ts               # tipos generados de Supabase
├── tests/
│   ├── engine/  ingest/  scans/  alerts/
│   └── fixtures/                       # secretos FALSOS (ver "Pruebas obligatorias")
└── public/
```

Contrato del motor (`src/lib/engine/types.ts`); la detección **no tiene campo con el secreto original**:
```ts
type Severity = "critical" | "high" | "medium" | "low";
interface Detection {
  secretType: string;        // p. ej. "aws_access_key"
  severity: Severity;
  method: "regex" | "entropy";
  fingerprint: string;       // HMAC-SHA-256 hex
  maskedValue: string;
  line: number;
  maskedContext: string;     // línea con todos los secretos enmascarados
}
// scanFile({ path, content }, { pepper }) => Detection[]
```

## Flujo de trabajo: checkpoints, commits y tags
Se construye por checkpoints; cada uno es un commit con sus pruebas en verde. Trabajar **un checkpoint a la vez** y no avanzar al siguiente sin que el usuario lo indique. Rama de producción en Vercel: `main`. Se trabaja en `develop` y el usuario fusiona `develop` → `main` para desplegar.

| # | Commit | Contenido | Verificación |
|---|---|---|---|
| 0 | `docs: documentación inicial` | README, `CLAUDE.md`, `docs/*`, `001_schema.sql`, `.gitignore`, `.env.example` | — |
| 1 | `chore: esqueleto del proyecto` | Next.js + TS strict + Tailwind + ESLint, Vitest, carpetas, `config.ts` | `lint`, `tsc --noEmit`, `npm test` corre sin pruebas, `npm run build` |
| 2 | `feat(db): clientes de Supabase y tipos` | `supabase/{browser,server,admin}.ts`, `types/database.ts`; **el usuario aplica `001_schema.sql`** | Consulta de prueba; **prueba manual de RLS con dos cuentas** |
| 3 | `feat(auth): registro e inicio de sesión` | Supabase Auth (correo/contraseña), `middleware.ts`, layout de la app | Login, logout y ruta protegida redirige |
| 4 | `feat(deploy): despliegue de prueba` | `/api/health`, variables en Vercel | **Despliegue en Vercel**: login funciona en producción; confirmar límites de función |
| 5 | `feat(engine): tipos y catálogo de patrones` | `types.ts`, `patterns.ts` con severidades | Cada patrón: positivo y casi-positivo |
| 6 | `feat(engine): entropía de Shannon` | `entropy.ts`, umbrales y exclusiones | UUID, hash de lockfile y base64 de imagen no se marcan |
| 7 | `feat(engine): enmascarado y huella` | `mask.ts`, `fingerprint.ts` | Invariantes de máscara; HMAC determinista y dependiente del pepper |
| 8 | `feat(engine): filtros y escáner` | `filters.ts`, `scanner.ts`, `index.ts` | Corpus de falsos/verdaderos positivos; ReDoS; sin texto plano en la salida |
| 9 | `feat(ingest): validación y descompresión` | `github-url.ts`, `zip-client.ts` | Zip slip, zip bomb, URLs inválidas, lotes ≤ 3 MB |
| 10 | `feat(api): crear escaneo y procesar lotes` | `create.ts`, `process-chunk.ts`, `persist.ts`, rate limit, rutas `/api/scans` y `/chunks` | Pruebas con persistencia en memoria + prueba manual contra Supabase de desarrollo |
| 11 | `feat(api): finalizar, auto-resolución y limpieza` | `finalize.ts`, `auto-resolve.ts`, `cleanup.ts`, ruta `/finalize` | Reglas de ciclo de vida y reapertura |
| 12 | `feat(alerts): webhook cifrado y envío a Discord` | `crypto.ts`, `discord.ts`, `dispatch.ts`, `/api/settings/webhook` | Cifrado ida y vuelta; manipulación detectada; reintentos; **prueba real con el webhook del usuario** |
| 13 | `feat(api): escaneo de repositorios de GitHub` | `github.ts`, token de la aplicación, guarda de tiempo | Tarball de prueba local; repo público pequeño; **medir tiempo en Vercel** |
| 14 | `feat(web): layout, navegación y tema` | Tokens de diseño (cian, púrpura, coral), barra lateral, `labels.ts` | Revisión visual del usuario |
| 15 | `feat(web): proyectos y nuevo escaneo` | CRUD de proyectos, pantalla de ingesta (4 modos), progreso en vivo | Flujo completo con snippet, ZIP y GitHub |
| 16 | `feat(web): dashboard` | KPIs, score, gráficas por severidad y tendencia | Coincide con `project_score_v` |
| 17 | `feat(web): hallazgos e inspección` | Tabla con filtros, inspección con Monaco (solo lectura), cambio de estado con nota | Las transiciones quedan en el log |
| 18 | `feat(web): informes` | Historial y detalle de escaneos, línea de tiempo, TTR, entregas de alertas | Datos coinciden con las tablas de log |
| 19 | `feat(web): configuración de alertas` | Pantalla de webhook y activación | Enviar prueba; el webhook nunca vuelve al cliente |
| 20 | `style(web): pulido de interfaz` | Estados vacío/carga/error, responsivo, accesibilidad | Revisión visual |
| 21 | `test: endurecimiento y auditoría` | Pruebas de seguridad, `npm audit`, revisión de RLS | Ver lista abajo; **LEAT escanea su propio repositorio** |
| 22 | `docs: README final` | Capturas, instalación, enlace al despliegue | — |

**Verificación del checkpoint 21**: RLS con dos cuentas (ninguna ve datos de la otra), rate limit, zip bomb y ReDoS, búsqueda de secretos o contenido de archivos en logs, `npm audit`, y un escaneo de LEAT sobre su propio repo (debe dar cero hallazgos reales).

**Tags** (anotados, `git tag -a`): `v0.1-engine` tras el checkpoint 8 (motor completo sin servidor); `v0.2-api` tras el 13 (backend completo); `v1.0` tras el 22.

**Convención de mensajes**: Conventional Commits, tipo en inglés y descripción en español (`feat(engine): agrega entropía de Shannon con umbrales por charset`). Un commit por checkpoint, sin mezclar cambios de otros. El trailer de coautoría está permitido y se agrega al final del mensaje cuando la sesión lo indique.

**Seguridad en commits, tags y push (obligatorio)**
1. Antes de cada commit: ejecutar las pruebas del checkpoint, mostrar `git status` y `git diff --staged` y **esperar la aprobación explícita del usuario**. Agregar archivos por nombre, nunca `git add -A` a ciegas.
2. Nunca versionar secretos ni archivos locales (`.env`, `.env.local`, `.vercel/`, `node_modules/`, `.next/`). Nunca leer ni imprimir `.env*`.
3. **Nunca hacer `git push` sin autorización explícita en ese momento**; la aprobación de un commit no autoriza el push. Tampoco `--force`, `reset --hard`, reescritura de historia ni borrado de ramas o tags.
4. Crear un tag solo cuando el usuario lo pida o confirme, y empujarlo solo con su autorización.
5. Si fallan las pruebas, no commitear: explicar el fallo y proponer la corrección.

**Base de datos**
- No ejecutar SQL contra Supabase ni usar llaves reales sin autorización; las migraciones las aplica el usuario (SQL Editor o CLI).
- `001_schema.sql` ya aplicada no se edita: cualquier cambio va en una migración nueva (`002_*.sql`, etc.) y se explica antes de crearla.

**Despliegue en Vercel (cuándo)**
- **Checkpoint 4**: despliegue de prueba para validar variables de entorno, autenticación en producción y los límites de función (duración, memoria, body).
- **Checkpoint 13**: probar el escaneo de GitHub en producción y medir tiempos.
- **Antes de `v1.0`**: pasada completa en producción desde incógnito, escritorio y móvil.
- Los despliegues y vincular el repo a Vercel los hace el usuario o requieren su autorización; no ejecutar comandos de despliegue por cuenta propia.

## Pruebas obligatorias
- **Motor**: cada patrón del catálogo tiene al menos un positivo y un casi-positivo; UUID, hash de lockfile y base64 de imagen no se marcan; el nombre de variable con contexto sube la severidad; tiempo acotado con entradas patológicas (ReDoS); la huella es determinista y cambia con el pepper.
- **Sin texto plano**: para toda salida del motor y toda fila que se vaya a persistir, la serialización a JSON **no contiene** el secreto original. Además, la máscara nunca revela más de 8 caracteres y enmascara todos los secretos de la línea.
- **Ingesta**: zip slip (`../`, rutas absolutas), zip bomb, URLs de GitHub inválidas (otro host, credenciales, puerto, `..`, esquemas distintos de https), lotes ≤ 3 MB, truncado correcto con `is_full_scan = false`.
- **Ciclo de vida**: nuevo → `active`; re-detección de `resolved` → reabre; `ignored` y `false_positive` no se reabren; la auto-resolución solo ocurre con escaneos completos de `zip`/`github`.
- **Alertas**: solo nuevos o reabiertos con severidad Alta/Crítica; el payload solo lleva datos enmascarados; cifrado AES-GCM ida y vuelta y detección de manipulación; máximo 3 reintentos y cada intento queda registrado.
- **Acceso**: los endpoints rechazan `scan_id` o `project_id` de otro usuario; el `user_id` nunca se toma del body.

**Fixtures de secretos falsos**: nunca usar secretos reales. Los valores de prueba se arman **en tiempo de ejecución concatenando fragmentos** (por ejemplo `"AKIA" + "IOSFODNN7EXAMPLE"`), para que no disparen la protección de push de GitHub ni al propio LEAT cuando escanee su repo.

## Comandos
- Pruebas: `npm test` (antes de cada commit)
- Tipos y lint: `npx tsc --noEmit` y `npm run lint`
- Desarrollo: `npm run dev`
- Build: `npm run build`

## Convenciones
- TypeScript `strict`, sin `any`; exports con nombre; entradas de API validadas con `zod`.
- El motor y `lib/scans` no importan componentes ni dependen de Next; la persistencia entra por una interfaz (`persist.ts`) para poder probar con una implementación en memoria.
- Componentes de servidor por defecto; `"use client"` solo donde haga falta (editor, gráficas, progreso en vivo).
- No agregar funcionalidad fuera de las decisiones (repos privados, historial de commits, reglas personalizadas, exportación de informes) sin consultarlo.
