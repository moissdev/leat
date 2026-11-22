-- =====================================================================
-- LEAT: prueba MANUAL de RLS con dos cuentas (SQL Editor de Supabase)
-- =====================================================================
-- Requisitos: dos usuarios de prueba creados en Authentication → Users.
-- 1. Sustituye <UUID_A> y <UUID_B> por sus IDs (columna "UID").
-- 2. Ejecuta el bloque completo. Termina en ROLLBACK: no deja datos.
-- 3. Compara cada resultado con el comentario "Esperado".
--
-- Cómo funciona: `set local role authenticated` + `request.jwt.claims`
-- reproducen lo que hace PostgREST con la sesión de un usuario, así que
-- auth.uid() devuelve el UUID indicado y se aplican GRANT y políticas RLS.
-- =====================================================================

begin;

-- ---------- Usuario A crea un proyecto ----------
select set_config('request.jwt.claims',
  json_build_object('sub', '<UUID_A>', 'role', 'authenticated')::text, true);
set local role authenticated;

insert into public.projects (name) values ('rls-test-a');

-- Esperado: 1 fila (rls-test-a), con user_id = <UUID_A> por el default auth.uid()
select 'A ve sus proyectos' as prueba, name, user_id from public.projects;

-- ---------- Usuario B intenta ver y modificar el proyecto de A ----------
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', '<UUID_B>', 'role', 'authenticated')::text, true);
set local role authenticated;

-- Esperado: 0 filas
select 'B ve proyectos de A' as prueba, count(*) from public.projects where name = 'rls-test-a';

-- Esperado: 0 filas afectadas
with u as (update public.projects set name = 'hackeado' where name = 'rls-test-a' returning 1)
select 'B actualiza proyecto de A' as prueba, count(*) from u;

-- Esperado: 0 filas afectadas
with d as (delete from public.projects where name = 'rls-test-a' returning 1)
select 'B borra proyecto de A' as prueba, count(*) from d;

-- Esperado: 0 filas en el resto de tablas (B no tiene datos y no ve los de nadie)
select 'B ve escaneos/hallazgos/logs ajenos' as prueba,
  (select count(*) from public.scans)
  + (select count(*) from public.findings)
  + (select count(*) from public.finding_occurrences)
  + (select count(*) from public.scan_logs)
  + (select count(*) from public.vulnerability_lifecycle_logs)
  + (select count(*) from public.alert_logs) as total;

-- ---------- Usuario A confirma que su proyecto sigue intacto ----------
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', '<UUID_A>', 'role', 'authenticated')::text, true);
set local role authenticated;

-- Esperado: 1 fila con name = 'rls-test-a'
select 'A tras ataque de B' as prueba, name from public.projects;

rollback;

-- =====================================================================
-- Prueba aparte (ejecutar sola; debe FALLAR con "permission denied"):
-- un usuario no puede fijar user_id de otro al insertar, porque el GRANT
-- de insert solo cubre (name, github_owner, github_repo).
-- =====================================================================
-- begin;
-- select set_config('request.jwt.claims',
--   json_build_object('sub', '<UUID_B>', 'role', 'authenticated')::text, true);
-- set local role authenticated;
-- insert into public.projects (name, user_id) values ('suplantacion', '<UUID_A>');
-- rollback;
