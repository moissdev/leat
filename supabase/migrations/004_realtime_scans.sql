-- =====================================================================
-- 004: Realtime para el progreso de escaneos
-- La UI sigue el progreso de un escaneo con Supabase Realtime sobre su fila
-- de public.scans (con polling de respaldo). Realtime respeta RLS: cada
-- usuario solo recibe cambios de sus propios escaneos.
-- =====================================================================

alter publication supabase_realtime add table public.scans;
