-- =====================================================================
-- Sinalização de conta "limitada / em verificação"
-- Quando o X aceita o like mas DESCARTA o retweet (resposta vazia), a conta
-- está em estado read-only/limitado (precisa de telefone/captcha). Marcamos
-- com limited_at pra você saber quais contas verificar.
-- Cole no Supabase -> SQL Editor -> Run. Idempotente.
-- =====================================================================
ALTER TABLE public.twitter_accounts
  ADD COLUMN IF NOT EXISTS limited_at timestamptz;

NOTIFY pgrst, 'reload schema';
