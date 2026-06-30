-- =====================================================================
-- Liga/desliga a QUARENTENA por shadowban (por usuário).
-- Default: DESLIGADA -> contas em shadowban continuam sendo usadas normalmente.
-- Quando LIGADA -> contas em shadowban deixam de ser usadas nas ações.
-- Cole no Supabase -> SQL Editor -> Run. Idempotente.
-- =====================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS quarantine_enabled boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
-- Pronto. O toggle fica na página de Shadowban dentro do SaaS.
