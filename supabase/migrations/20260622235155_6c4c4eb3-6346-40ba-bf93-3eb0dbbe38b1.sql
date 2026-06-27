
-- Enums
CREATE TYPE public.proxy_status AS ENUM ('active', 'dead', 'unknown');
CREATE TYPE public.twitter_account_status AS ENUM ('active', 'paused', 'banned', 'unknown');
CREATE TYPE public.flow_status AS ENUM ('active', 'paused', 'draft');
CREATE TYPE public.queue_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- PROXIES
CREATE TABLE public.proxies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT,
  ip TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT,
  password TEXT,
  status public.proxy_status NOT NULL DEFAULT 'unknown',
  last_tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proxies TO authenticated;
GRANT ALL ON public.proxies TO service_role;
ALTER TABLE public.proxies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proxies_owner_all" ON public.proxies FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_proxies_updated BEFORE UPDATE ON public.proxies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- TWITTER ACCOUNTS
CREATE TABLE public.twitter_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT,
  profile_picture_url TEXT,
  auth_tokens JSONB NOT NULL DEFAULT '{}'::jsonb,
  proxy_id UUID REFERENCES public.proxies(id) ON DELETE SET NULL,
  status public.twitter_account_status NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, username)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.twitter_accounts TO authenticated;
GRANT ALL ON public.twitter_accounts TO service_role;
ALTER TABLE public.twitter_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "twitter_accounts_owner_all" ON public.twitter_accounts FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_twitter_accounts_updated BEFORE UPDATE ON public.twitter_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- AUTOMATION FLOWS
CREATE TABLE public.automation_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
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
CREATE POLICY "automation_flows_owner_all" ON public.automation_flows FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_automation_flows_updated BEFORE UPDATE ON public.automation_flows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- EXECUTION QUEUE
CREATE TABLE public.execution_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  twitter_account_id UUID REFERENCES public.twitter_accounts(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  status public.queue_status NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.execution_queue TO authenticated;
GRANT ALL ON public.execution_queue TO service_role;
ALTER TABLE public.execution_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "execution_queue_owner_all" ON public.execution_queue FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_execution_queue_status_sched ON public.execution_queue(status, scheduled_for);
CREATE TRIGGER trg_execution_queue_updated BEFORE UPDATE ON public.execution_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- EXECUTION LOGS
CREATE TABLE public.execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flow_id UUID REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  twitter_account_id UUID REFERENCES public.twitter_accounts(id) ON DELETE SET NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  error_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.execution_logs TO authenticated;
GRANT ALL ON public.execution_logs TO service_role;
ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "execution_logs_owner_all" ON public.execution_logs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_execution_logs_flow ON public.execution_logs(flow_id, created_at DESC);
