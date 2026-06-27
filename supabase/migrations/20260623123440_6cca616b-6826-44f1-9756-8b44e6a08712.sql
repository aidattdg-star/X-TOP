ALTER TABLE public.flow_monitor_state
  ADD COLUMN IF NOT EXISTS processed_tweet_ids text[] NOT NULL DEFAULT ARRAY[]::text[];