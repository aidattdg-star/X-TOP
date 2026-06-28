-- =====================================================================
-- Cadeado de aquecimento: conta em educação fica travada por ~1 dia,
-- sem participar de ações de spam (RT/like massa, monitor, fluxos).
-- Cole no Supabase -> SQL Editor -> Run. Idempotente.
-- =====================================================================
ALTER TABLE public.twitter_accounts
  ADD COLUMN IF NOT EXISTS warming_until timestamptz;

NOTIFY pgrst, 'reload schema';
