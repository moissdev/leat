-- =====================================================================
-- LEAT: esquema inicial (Supabase / PostgreSQL)
-- =====================================================================

-- ---------- Tipos ----------
create type public.severity_level   as enum ('critical', 'high', 'medium', 'low');
create type public.finding_status   as enum ('active', 'resolved', 'ignored', 'false_positive');
create type public.scan_status      as enum ('queued', 'running', 'completed', 'failed');
create type public.ingest_type      as enum ('snippet', 'file', 'zip', 'github');
create type public.detection_method as enum ('regex', 'entropy');
create type public.change_actor     as enum ('user', 'system');

-- ---------- Configuración del usuario ----------
create table public.user_settings (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  discord_webhook_ct       text,          -- AES-256-GCM: texto cifrado (base64)
  discord_webhook_iv       text,
  discord_webhook_tag      text,
  encryption_key_version   smallint not null default 1,
  webhook_configured       boolean generated always as (discord_webhook_ct is not null) stored,
  alerts_enabled           boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ---------- Proyectos ----------
create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  github_owner text,
  github_repo  text,
  created_at   timestamptz not null default now(),
  unique (user_id, name),
  constraint projects_github_pair check (
    (github_owner is null and github_repo is null)
    or (github_owner is not null and github_repo is not null
        and github_owner ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'
        and github_repo ~ '^[A-Za-z0-9._-]{1,100}$')
  )
);

-- ---------- Escaneos (registro resumen) ----------
create table public.scans (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  project_id       uuid not null references public.projects(id) on delete cascade,
  ingest           public.ingest_type not null,
  status           public.scan_status not null default 'queued',
  is_full_scan     boolean not null default false,   -- cobertura completa (sin truncar)
  source_ref       text,                             -- commit SHA o nombre del archivo/zip
  files_total      integer not null default 0,
  files_scanned    integer not null default 0,
  files_skipped    integer not null default 0,       -- filtrados (binarios, lockfiles, etc.)
  files_truncated  integer not null default 0,       -- omitidos por límites
  bytes_scanned    bigint  not null default 0,
  chunks_received  integer not null default 0,
  findings_new     integer not null default 0,
  findings_reopened integer not null default 0,
  occurrences_total integer not null default 0,
  error_message    text,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);
create index scans_user_created_idx on public.scans (user_id, created_at desc);
create index scans_project_idx      on public.scans (project_id, created_at desc);

-- ---------- Hallazgos (un secreto único por proyecto) ----------
create table public.findings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  project_id        uuid not null references public.projects(id) on delete cascade,
  fingerprint       text not null,                  -- HMAC-SHA-256 (hex) del secreto
  secret_type       text not null,                  -- p. ej. 'aws_access_key'
  severity          public.severity_level not null,
  method            public.detection_method not null,
  masked_value      text not null check (char_length(masked_value) <= 32),
  status            public.finding_status not null default 'active',
  status_note       text check (char_length(status_note) <= 500),
  first_scan_id     uuid references public.scans(id) on delete set null,
  last_scan_id      uuid references public.scans(id) on delete set null,
  first_detected_at timestamptz not null default now(),
  last_detected_at  timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  resolved_at       timestamptz,
  unique (project_id, fingerprint)
);
create index findings_project_status_idx on public.findings (project_id, status);
create index findings_user_severity_idx  on public.findings (user_id, severity, status);

-- ---------- Ocurrencias (dónde apareció, por escaneo) ----------
create table public.finding_occurrences (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  finding_id     uuid not null references public.findings(id) on delete cascade,
  scan_id        uuid not null references public.scans(id) on delete cascade,
  file_path      text not null check (char_length(file_path) <= 500),
  line_number    integer not null check (line_number > 0),
  masked_context text not null check (char_length(masked_context) <= 300),
  created_at     timestamptz not null default now(),
  unique (finding_id, scan_id, file_path, line_number)
);
create index occurrences_finding_idx on public.finding_occurrences (finding_id);
create index occurrences_scan_idx    on public.finding_occurrences (scan_id);

-- ---------- Logs de auditoría (append-only) ----------
create table public.scan_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  scan_id    uuid not null references public.scans(id) on delete cascade,
  level      text not null check (level in ('info', 'warn', 'error')),
  event      text not null,                  -- p. ej. 'scan_started', 'chunk_processed'
  message    text,
  metadata   jsonb not null default '{}'::jsonb,  -- NUNCA contenido de archivos ni secretos
  created_at timestamptz not null default now()
);
create index scan_logs_scan_idx on public.scan_logs (scan_id, created_at);

create table public.vulnerability_lifecycle_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  finding_id  uuid not null references public.findings(id) on delete cascade,
  from_status public.finding_status,         -- null = primera detección
  to_status   public.finding_status not null,
  actor       public.change_actor not null,
  reason      text,
  ttr_seconds bigint,                        -- solo cuando to_status = 'resolved'
  created_at  timestamptz not null default now()
);
create index lifecycle_finding_idx on public.vulnerability_lifecycle_logs (finding_id, created_at);

create table public.alert_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  scan_id     uuid references public.scans(id) on delete set null,
  channel     text not null default 'discord',
  severity    public.severity_level not null,
  attempt     smallint not null check (attempt between 1 and 5),
  success     boolean not null,
  http_status integer,
  error       text,
  created_at  timestamptz not null default now()
);
create index alert_logs_user_idx on public.alert_logs (user_id, created_at desc);

-- =====================================================================
-- Triggers de ciclo de vida
-- =====================================================================

-- 1) Antes de actualizar: mantiene marcas de tiempo coherentes.
create or replace function public.fn_finding_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    new.resolved_at := case when new.status = 'resolved' then now() else null end;
  end if;
  return new;
end;
$$;

create trigger trg_finding_before_update
before update on public.findings
for each row execute function public.fn_finding_before_update();

-- 2) Después de insertar/actualizar: escribe el log de transición.
--    SECURITY DEFINER porque el rol 'authenticated' no puede insertar en logs.
--    auth.uid() es null cuando escribe el motor (service_role) => actor 'system'.
create or replace function public.fn_finding_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.vulnerability_lifecycle_logs
      (user_id, finding_id, from_status, to_status, actor, reason)
    values
      (new.user_id, new.id, null, new.status, 'system', 'first_detected');
  elsif new.status is distinct from old.status then
    insert into public.vulnerability_lifecycle_logs
      (user_id, finding_id, from_status, to_status, actor, reason, ttr_seconds)
    values (
      new.user_id, new.id, old.status, new.status,
      case when auth.uid() is null then 'system'::public.change_actor
           else 'user'::public.change_actor end,
      new.status_note,
      case when new.status = 'resolved'
           then extract(epoch from (new.resolved_at - new.first_detected_at))::bigint
      end
    );
  end if;
  return new;
end;
$$;

create trigger trg_finding_audit
after insert or update on public.findings
for each row execute function public.fn_finding_audit();

-- =====================================================================
-- Vistas para informes y dashboard (respetan RLS del usuario que consulta)
-- =====================================================================

create view public.scan_report_v with (security_invoker = true) as
select
  s.id, s.user_id, s.project_id, p.name as project_name,
  s.ingest, s.status, s.is_full_scan, s.source_ref,
  s.files_total, s.files_scanned, s.files_skipped, s.files_truncated,
  s.bytes_scanned, s.findings_new, s.findings_reopened, s.occurrences_total,
  s.error_message, s.created_at, s.started_at, s.finished_at,
  case when s.finished_at is not null and s.started_at is not null
       then (extract(epoch from (s.finished_at - s.started_at)) * 1000)::bigint
  end as duration_ms
from public.scans s
join public.projects p on p.id = s.project_id;

-- Score = max(0, 100 - (25*críticas + 10*altas + 4*medias + 1*bajas)) sobre hallazgos activos
create view public.project_score_v with (security_invoker = true) as
select
  p.id as project_id,
  p.user_id,
  p.name as project_name,
  count(f.id) filter (where f.status = 'active' and f.severity = 'critical') as active_critical,
  count(f.id) filter (where f.status = 'active' and f.severity = 'high')     as active_high,
  count(f.id) filter (where f.status = 'active' and f.severity = 'medium')   as active_medium,
  count(f.id) filter (where f.status = 'active' and f.severity = 'low')      as active_low,
  greatest(0, 100 - (
      25 * count(f.id) filter (where f.status = 'active' and f.severity = 'critical')
    + 10 * count(f.id) filter (where f.status = 'active' and f.severity = 'high')
    +  4 * count(f.id) filter (where f.status = 'active' and f.severity = 'medium')
    +  1 * count(f.id) filter (where f.status = 'active' and f.severity = 'low')
  ))::int as score
from public.projects p
left join public.findings f on f.project_id = p.id
group by p.id, p.user_id, p.name;

-- Tiempo medio de remediación por severidad
create view public.ttr_summary_v with (security_invoker = true) as
select
  f.user_id,
  f.project_id,
  f.severity,
  count(*) as resolved_count,
  avg(l.ttr_seconds)::bigint as avg_ttr_seconds
from public.vulnerability_lifecycle_logs l
join public.findings f on f.id = l.finding_id
where l.to_status = 'resolved' and l.ttr_seconds is not null
group by f.user_id, f.project_id, f.severity;

-- =====================================================================
-- Seguridad: privilegios + RLS
-- service_role omite RLS: el código del servidor debe filtrar por user_id.
-- =====================================================================

revoke all on all tables in schema public from anon, authenticated;

alter table public.user_settings                enable row level security;
alter table public.projects                     enable row level security;
alter table public.scans                        enable row level security;
alter table public.findings                     enable row level security;
alter table public.finding_occurrences          enable row level security;
alter table public.scan_logs                    enable row level security;
alter table public.vulnerability_lifecycle_logs enable row level security;
alter table public.alert_logs                   enable row level security;

-- user_settings: lectura de columnas no sensibles; el webhook cifrado nunca
-- se expone al cliente (se escribe/lee solo desde el servidor).
grant select (user_id, webhook_configured, alerts_enabled, updated_at)
  on public.user_settings to authenticated;
grant update (alerts_enabled) on public.user_settings to authenticated;

create policy user_settings_select on public.user_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_settings_update on public.user_settings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- projects: CRUD propio
grant select, delete on public.projects to authenticated;
grant insert (name, github_owner, github_repo) on public.projects to authenticated;
grant update (name, github_owner, github_repo) on public.projects to authenticated;

create policy projects_select on public.projects
  for select to authenticated using (user_id = (select auth.uid()));
create policy projects_insert on public.projects
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy projects_update on public.projects
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy projects_delete on public.projects
  for delete to authenticated using (user_id = (select auth.uid()));

-- findings: lectura + cambio de estado (solo status y nota)
grant select on public.findings to authenticated;
grant update (status, status_note) on public.findings to authenticated;

create policy findings_select on public.findings
  for select to authenticated using (user_id = (select auth.uid()));
create policy findings_update on public.findings
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Solo lectura para el resto (escribe únicamente el motor con service_role)
grant select on public.scans                        to authenticated;
grant select on public.finding_occurrences          to authenticated;
grant select on public.scan_logs                    to authenticated;
grant select on public.vulnerability_lifecycle_logs to authenticated;
grant select on public.alert_logs                   to authenticated;

create policy scans_select on public.scans
  for select to authenticated using (user_id = (select auth.uid()));
create policy occurrences_select on public.finding_occurrences
  for select to authenticated using (user_id = (select auth.uid()));
create policy scan_logs_select on public.scan_logs
  for select to authenticated using (user_id = (select auth.uid()));
create policy lifecycle_select on public.vulnerability_lifecycle_logs
  for select to authenticated using (user_id = (select auth.uid()));
create policy alert_logs_select on public.alert_logs
  for select to authenticated using (user_id = (select auth.uid()));

-- Vistas
grant select on public.scan_report_v, public.project_score_v, public.ttr_summary_v
  to authenticated;

-- Realtime (progreso de escaneos en la UI): habilitar en el panel de Supabase
-- o con:  alter publication supabase_realtime add table public.scans;