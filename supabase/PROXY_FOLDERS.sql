-- =====================================================================
-- Pastas de PROXY: agrupa proxies em pastas (ex.: por lote/fornecedor),
-- pra na importação de contas escolher uma pasta e cada conta pegar um
-- proxy DIFERENTE da pasta (sem repetir uso).
-- Cole no Supabase -> SQL Editor -> Run. Idempotente.
-- =====================================================================

-- ---------- TABELA proxy_folders ----------
CREATE TABLE IF NOT EXISTS public.proxy_folders (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proxy_folders TO authenticated;
GRANT ALL ON public.proxy_folders TO service_role;
ALTER TABLE public.proxy_folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proxy_folders_owner_all ON public.proxy_folders;
CREATE POLICY proxy_folders_owner_all ON public.proxy_folders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_proxy_folders_updated ON public.proxy_folders;
CREATE TRIGGER trg_proxy_folders_updated BEFORE UPDATE ON public.proxy_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- vínculo proxy -> pasta ----------
ALTER TABLE public.proxies
  ADD COLUMN IF NOT EXISTS folder_id uuid
    REFERENCES public.proxy_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS proxies_folder_idx
  ON public.proxies (user_id, folder_id);

NOTIFY pgrst, 'reload schema';
-- Pronto. Apague uma pasta e os proxies dela apenas voltam para "Sem pasta".
