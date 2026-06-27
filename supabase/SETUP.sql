-- =====================================================================
-- MimixLab Automation Suite — Setup do banco (Supabase)
-- Cole TODO este conteúdo no Dashboard -> SQL Editor -> Run.
-- Idempotente: pode rodar mais de uma vez sem erro.
-- (O agendamento do worker via pg_cron fica num passo separado.)
-- =====================================================================

-- ---------- ENUMS (idempotentes) ----------
DO $$ BEGIN CREATE TYPE public.proxy_status AS ENUM ('active','dead','unknown'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.twitter_account_status AS ENUM ('active','paused','banned','unknown'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.flow_status AS ENUM ('active','paused','draft'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.queue_status AS ENUM ('pending','processing','completed','failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.education_task_status AS ENUM ('pending','processing','completed','failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.media_category AS ENUM ('profile_picture','tweet_media'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE public.profile_field AS ENUM ('avatar','banner','name','bio','username'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ---------- updated_at helper ----------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- ---------- PROXIES ----------
CREATE TABLE IF NOT EXISTS public.proxies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT, ip TEXT NOT NULL, port INTEGER NOT NULL,
  username TEXT, password TEXT,
  status public.proxy_status NOT NULL DEFAULT 'unknown',
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proxies TO authenticated;
GRANT ALL ON public.proxies TO service_role;
ALTER TABLE public.proxies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "proxies_owner_all" ON public.proxies;
CREATE POLICY "proxies_owner_all" ON public.proxies FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_proxies_updated ON public.proxies;
CREATE TRIGGER trg_proxies_updated BEFORE UPDATE ON public.proxies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- TWITTER ACCOUNTS ----------
CREATE TABLE IF NOT EXISTS public.twitter_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL, display_name TEXT, profile_picture_url TEXT,
  auth_tokens JSONB NOT NULL DEFAULT '{}'::jsonb,
  proxy_id UUID REFERENCES public.proxies(id) ON DELETE SET NULL,
  status public.twitter_account_status NOT NULL DEFAULT 'unknown',
  last_used_at TIMESTAMPTZ, cooldown_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, username)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.twitter_accounts TO authenticated;
GRANT ALL ON public.twitter_accounts TO service_role;
ALTER TABLE public.twitter_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "twitter_accounts_owner_all" ON public.twitter_accounts;
CREATE POLICY "twitter_accounts_owner_all" ON public.twitter_accounts FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_twitter_accounts_updated ON public.twitter_accounts;
CREATE TRIGGER trg_twitter_accounts_updated BEFORE UPDATE ON public.twitter_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS twitter_accounts_pool_idx
  ON public.twitter_accounts (user_id, status, cooldown_until, last_used_at);

-- ---------- AUTOMATION FLOWS ----------
CREATE TABLE IF NOT EXISTS public.automation_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT,
  status public.flow_status NOT NULL DEFAULT 'draft',
  react_flow_data JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  execution_interval TEXT,
  account_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_flows TO authenticated;
GRANT ALL ON public.automation_flows TO service_role;
ALTER TABLE public.automation_flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "automation_flows_owner_all" ON public.automation_flows;
CREATE POLICY "automation_flows_owner_all" ON public.automation_flows FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_automation_flows_updated ON public.automation_flows;
CREATE TRIGGER trg_automation_flows_updated BEFORE UPDATE ON public.automation_flows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- EXECUTION QUEUE ----------
CREATE TABLE IF NOT EXISTS public.execution_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  twitter_account_id UUID REFERENCES public.twitter_accounts(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  status public.queue_status NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.execution_queue TO authenticated;
GRANT ALL ON public.execution_queue TO service_role;
ALTER TABLE public.execution_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "execution_queue_owner_all" ON public.execution_queue;
CREATE POLICY "execution_queue_owner_all" ON public.execution_queue FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_execution_queue_status_sched ON public.execution_queue(status, scheduled_for);
DROP TRIGGER IF EXISTS trg_execution_queue_updated ON public.execution_queue;
CREATE TRIGGER trg_execution_queue_updated BEFORE UPDATE ON public.execution_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- EXECUTION LOGS ----------
CREATE TABLE IF NOT EXISTS public.execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flow_id UUID REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  twitter_account_id UUID REFERENCES public.twitter_accounts(id) ON DELETE SET NULL,
  level TEXT NOT NULL DEFAULT 'info', message TEXT NOT NULL, error_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.execution_logs TO authenticated;
GRANT ALL ON public.execution_logs TO service_role;
ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "execution_logs_owner_all" ON public.execution_logs;
CREATE POLICY "execution_logs_owner_all" ON public.execution_logs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_flow ON public.execution_logs(flow_id, created_at DESC);

-- ---------- FLOW MONITOR STATE ----------
CREATE TABLE IF NOT EXISTS public.flow_monitor_state (
  flow_id uuid PRIMARY KEY REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  last_tweet_id text,
  processed_tweet_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.flow_monitor_state TO authenticated;
GRANT ALL ON public.flow_monitor_state TO service_role;
ALTER TABLE public.flow_monitor_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner read state" ON public.flow_monitor_state;
CREATE POLICY "owner read state" ON public.flow_monitor_state FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.automation_flows f WHERE f.id = flow_id AND f.user_id = auth.uid()));

-- ---------- ACCOUNT EDUCATION ----------
CREATE TABLE IF NOT EXISTS public.account_education (
  twitter_account_id UUID NOT NULL PRIMARY KEY REFERENCES public.twitter_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true,
  keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_education TO authenticated;
GRANT ALL ON public.account_education TO service_role;
ALTER TABLE public.account_education ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_education_owner_all ON public.account_education;
CREATE POLICY account_education_owner_all ON public.account_education
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_account_education_updated_at ON public.account_education;
CREATE TRIGGER trg_account_education_updated_at BEFORE UPDATE ON public.account_education
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.education_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  twitter_account_id UUID NOT NULL REFERENCES public.twitter_accounts(id) ON DELETE CASCADE,
  tweet_id TEXT NOT NULL, keyword TEXT, view_count INTEGER NOT NULL DEFAULT 0,
  status public.education_task_status NOT NULL DEFAULT 'pending',
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (twitter_account_id, tweet_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.education_tasks TO authenticated;
GRANT ALL ON public.education_tasks TO service_role;
ALTER TABLE public.education_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS education_tasks_owner_all ON public.education_tasks;
CREATE POLICY education_tasks_owner_all ON public.education_tasks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_education_tasks_updated_at ON public.education_tasks;
CREATE TRIGGER trg_education_tasks_updated_at BEFORE UPDATE ON public.education_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS idx_education_tasks_pending
  ON public.education_tasks (status, scheduled_for) WHERE status = 'pending';

-- ---------- MEDIA ----------
CREATE TABLE IF NOT EXISTS public.media_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL, category public.media_category NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, category, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_folders TO authenticated;
GRANT ALL ON public.media_folders TO service_role;
ALTER TABLE public.media_folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "media_folders_owner_all" ON public.media_folders;
CREATE POLICY "media_folders_owner_all" ON public.media_folders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS trg_media_folders_updated ON public.media_folders;
CREATE TRIGGER trg_media_folders_updated BEFORE UPDATE ON public.media_folders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.media_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id uuid NOT NULL REFERENCES public.media_folders(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE, original_filename text NOT NULL,
  mime_type text NOT NULL, size_bytes integer NOT NULL,
  width integer, height integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_files TO authenticated;
GRANT ALL ON public.media_files TO service_role;
ALTER TABLE public.media_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "media_files_owner_all" ON public.media_files;
CREATE POLICY "media_files_owner_all" ON public.media_files
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS media_files_folder_idx ON public.media_files (folder_id, created_at DESC);

-- ---------- PROFILE UPDATE LOG ----------
CREATE TABLE IF NOT EXISTS public.profile_update_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  twitter_account_id uuid NOT NULL REFERENCES public.twitter_accounts(id) ON DELETE CASCADE,
  field public.profile_field NOT NULL, old_value text, new_value text,
  status text NOT NULL DEFAULT 'ok', error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.profile_update_log TO authenticated;
GRANT ALL ON public.profile_update_log TO service_role;
ALTER TABLE public.profile_update_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profile_update_log_owner_select" ON public.profile_update_log;
CREATE POLICY "profile_update_log_owner_select" ON public.profile_update_log
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "profile_update_log_owner_insert" ON public.profile_update_log;
CREATE POLICY "profile_update_log_owner_insert" ON public.profile_update_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS profile_update_log_account_idx
  ON public.profile_update_log (twitter_account_id, created_at DESC);

-- ---------- STORAGE (bucket 'media' + policies) ----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('media','media', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "media_owner_select" ON storage.objects;
CREATE POLICY "media_owner_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "media_owner_insert" ON storage.objects;
CREATE POLICY "media_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "media_owner_update" ON storage.objects;
CREATE POLICY "media_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "media_owner_delete" ON storage.objects;
CREATE POLICY "media_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Pronto. Todas as tabelas, políticas e o bucket 'media' criados.
