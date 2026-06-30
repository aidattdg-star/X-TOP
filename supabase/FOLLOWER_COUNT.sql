-- =====================================================================
-- Contagem de seguidores por conta.
-- follower_count é atualizado ao testar contas online ou via sync manual.
-- Cole no Supabase -> SQL Editor -> Run. Seguro rodar de novo.
-- =====================================================================

ALTER TABLE public.twitter_accounts
  ADD COLUMN IF NOT EXISTS follower_count bigint;
