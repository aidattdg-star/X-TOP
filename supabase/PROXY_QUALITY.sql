-- =====================================================================
-- Qualidade de proxy: colunas novas + reload do schema.
-- Cole no Supabase -> SQL Editor -> Run. Idempotente.
-- =====================================================================
ALTER TABLE public.proxies
  ADD COLUMN IF NOT EXISTS latency_ms  integer,
  ADD COLUMN IF NOT EXISTS exit_ip     text,
  ADD COLUMN IF NOT EXISTS quality     text,                    -- 'good' | 'slow' | 'datacenter' | 'dead'
  ADD COLUMN IF NOT EXISTS fail_count  integer NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
