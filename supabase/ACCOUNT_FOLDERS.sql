-- =====================================================================
-- Pastas de contas: organiza as contas do X em pastas (ex.: por lote/bulk),
-- pra não empilhar centenas de contas numa lista só.
-- Cole no Supabase -> SQL Editor -> Run. Idempotente.
-- =====================================================================

-- ---------- TABELA account_folders ----------
CREATE TABLE IF NOT EXISTS public.account_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_folders TO authenticated;
GRANT ALL ON public.account_folders TO service_role;
ALTER TABLE public.account_folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_folders_owner_all ON public.account_folders;
CREATE POLICY account_folders_owner_all ON public.account_folders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_account_folders_updated ON public.account_folders;
CREATE TRIGGER trg_account_folders_updated BEFORE UPDATE ON public.account_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- vínculo conta -> pasta ----------
ALTER TABLE public.twitter_accounts
  ADD COLUMN IF NOT EXISTS folder_id uuid
    REFERENCES public.account_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS twitter_accounts_folder_idx
  ON public.twitter_accounts (user_id, folder_id);

NOTIFY pgrst, 'reload schema';
-- Pronto. Apague uma pasta e as contas dela apenas voltam para "Sem pasta".
