-- =====================================================================
-- Comunidades do X (X Communities) por conta.
-- Guarda as comunidades que cada conta enxerga/participa, pra poder postar
-- dentro delas pelo SaaS. Puxado via "Sincronizar comunidades".
-- Cole no Supabase -> SQL Editor -> Run. Idempotente.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.twitter_communities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES public.twitter_accounts(id) ON DELETE CASCADE,
  community_id text NOT NULL,                 -- id da comunidade no X
  name         text,
  description  text,
  member_count bigint,
  role         text,                          -- Member / Admin / Moderator / NonMember
  can_post     boolean NOT NULL DEFAULT false, -- a conta consegue publicar dentro?
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, community_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.twitter_communities TO authenticated;
GRANT ALL ON public.twitter_communities TO service_role;

ALTER TABLE public.twitter_communities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS twitter_communities_owner_all ON public.twitter_communities;
CREATE POLICY twitter_communities_owner_all ON public.twitter_communities
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS twitter_communities_user_idx
  ON public.twitter_communities (user_id, can_post);
CREATE INDEX IF NOT EXISTS twitter_communities_account_idx
  ON public.twitter_communities (account_id);

DROP TRIGGER IF EXISTS trg_twitter_communities_updated ON public.twitter_communities;
CREATE TRIGGER trg_twitter_communities_updated BEFORE UPDATE ON public.twitter_communities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

NOTIFY pgrst, 'reload schema';
-- Pronto. Use "Sincronizar comunidades" no SaaS pra preencher esta tabela.
