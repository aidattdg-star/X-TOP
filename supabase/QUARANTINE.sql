-- =====================================================================
-- Quarentena por SHADOWBAN.
-- shadowban_at = quando a conta foi detectada em shadowban (search ban).
-- Enquanto preenchido, a conta fica em "Quarentena" e não é usada em ações,
-- até passar no teste de novo (aí volta a NULL).
-- Cole no Supabase -> SQL Editor -> Run. Seguro rodar de novo.
-- =====================================================================

ALTER TABLE public.twitter_accounts
  ADD COLUMN IF NOT EXISTS shadowban_at timestamptz;
