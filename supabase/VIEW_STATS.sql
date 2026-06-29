-- =====================================================================
-- Views totais das contas — snapshot por conta + agendador (pg_cron).
-- 1) Troque <APP_URL> pela URL do app (ex.: https://x-top-one.vercel.app) — SEM barra final.
-- 2) Cole no Supabase -> SQL Editor -> Run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.account_view_stats (
  account_id uuid PRIMARY KEY REFERENCES public.twitter_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  username text,
  views bigint NOT NULL DEFAULT 0,
  tweets int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.account_view_stats TO authenticated;
GRANT ALL ON public.account_view_stats TO service_role;

ALTER TABLE public.account_view_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "account_view_stats_owner_select" ON public.account_view_stats;
CREATE POLICY "account_view_stats_owner_select" ON public.account_view_stats
  FOR SELECT USING (auth.uid() = user_id);

-- ---------- Agendador (coleta em segundo plano) ----------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('collect-views-every-5min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='collect-views-every-5min');

-- A cada 5 min processa um lote de contas (as mais desatualizadas primeiro).
SELECT cron.schedule(
  'collect-views-every-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url:='<APP_URL>/api/public/hooks/collect-views',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);

SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
