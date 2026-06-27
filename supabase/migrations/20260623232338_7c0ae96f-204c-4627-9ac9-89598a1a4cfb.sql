SELECT cron.schedule(
  'session-keepalive-every-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url:='https://project--0a8dbb27-c2db-4b62-9279-8cd653c4b780-dev.lovable.app/api/public/hooks/session-keepalive',
    headers:='{"Content-Type": "application/json"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);