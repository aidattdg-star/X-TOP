-- =====================================================================
-- Cota de ações antes do refresh: cada conta pode fazer 3 RT + 3 like;
-- ao atingir 3 RT E 3 like, entra em refresh (cooldown) de 1h e os
-- contadores zeram. Adiciona os contadores na twitter_accounts.
-- Cole no Supabase -> SQL Editor -> Run. Idempotente.
-- =====================================================================
ALTER TABLE public.twitter_accounts
  ADD COLUMN IF NOT EXISTS rt_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS like_count integer NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
