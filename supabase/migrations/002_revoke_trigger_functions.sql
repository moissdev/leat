-- =====================================================================
-- LEAT: 002 — revoca EXECUTE de las funciones de trigger
-- =====================================================================
-- Motivo: Postgres concede EXECUTE a PUBLIC al crear una función, y el
-- Security Advisor de Supabase marca fn_finding_audit() (SECURITY DEFINER)
-- como invocable por anon y authenticated vía /rest/v1/rpc.
-- Las funciones de trigger no deben exponerse por RPC. Postgres solo
-- comprueba EXECUTE al crear el trigger, no al dispararlo, así que los
-- triggers de findings siguen funcionando igual.

revoke execute on function public.fn_finding_audit()         from public, anon, authenticated;
revoke execute on function public.fn_finding_before_update() from public, anon, authenticated;
