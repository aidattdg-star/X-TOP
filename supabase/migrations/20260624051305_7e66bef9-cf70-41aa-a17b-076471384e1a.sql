ALTER TABLE public.twitter_accounts
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS cooldown_until timestamptz;

CREATE INDEX IF NOT EXISTS twitter_accounts_pool_idx
  ON public.twitter_accounts (user_id, status, cooldown_until, last_used_at);