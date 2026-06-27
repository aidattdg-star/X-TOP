
CREATE TYPE public.education_task_status AS ENUM ('pending','processing','completed','failed');

CREATE TABLE public.account_education (
  twitter_account_id UUID NOT NULL PRIMARY KEY REFERENCES public.twitter_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_education TO authenticated;
GRANT ALL ON public.account_education TO service_role;
ALTER TABLE public.account_education ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_education_owner_all ON public.account_education
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_account_education_updated_at
  BEFORE UPDATE ON public.account_education
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.education_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  twitter_account_id UUID NOT NULL REFERENCES public.twitter_accounts(id) ON DELETE CASCADE,
  tweet_id TEXT NOT NULL,
  keyword TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  status public.education_task_status NOT NULL DEFAULT 'pending',
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (twitter_account_id, tweet_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.education_tasks TO authenticated;
GRANT ALL ON public.education_tasks TO service_role;
ALTER TABLE public.education_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY education_tasks_owner_all ON public.education_tasks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_education_tasks_updated_at
  BEFORE UPDATE ON public.education_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_education_tasks_pending
  ON public.education_tasks (status, scheduled_for) WHERE status = 'pending';
