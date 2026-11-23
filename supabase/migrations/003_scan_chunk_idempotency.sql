-- =====================================================================
-- 003: idempotencia de lotes por chunk_index
-- Un mismo lote (scan_id, chunk_index) solo puede registrarse una vez como
-- 'chunk_processed'. Si un reintento llega mientras el primer intento sigue
-- en curso, el segundo registro falla con 23505 y la aplicación lo trata
-- como duplicado (los contadores se recalculan a partir de estos registros).
-- También acelera la consulta de "¿ya se procesó este lote?".
-- =====================================================================

create unique index scan_logs_chunk_unique_idx
  on public.scan_logs (scan_id, (metadata->>'chunk_index'))
  where event = 'chunk_processed';
