CREATE TABLE public.flow_monitor_state (
  flow_id uuid PRIMARY KEY REFERENCES public.automation_flows(id) ON DELETE CASCADE,
  last_tweet_id text,
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.flow_monitor_state TO authenticated;
GRANT ALL ON public.flow_monitor_state TO service_role;
ALTER TABLE public.flow_monitor_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner read state" ON public.flow_monitor_state FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.automation_flows f WHERE f.id = flow_id AND f.user_id = auth.uid()));