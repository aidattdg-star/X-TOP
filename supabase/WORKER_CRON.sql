-- =====================================================================
-- Agendador do worker (pg_cron) — roda DEPOIS do deploy na Vercel.
-- 1) Troque <APP_URL> pela URL da Vercel (ex.: https://seu-app.vercel.app) — SEM barra no final.
-- 2) Cole no Supabase -> SQL Editor -> Run.
-- Requer extensões pg_cron e pg_net (já disponíveis no seu projeto).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove agendamentos antigos com o mesmo nome (idempotente)
SELECT cron.unschedule('run-queue-every-1min')   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='run-queue-every-1min');
SELECT cron.unschedule('session-keepalive-15min') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='session-keepalive-15min');

-- Worker da fila: a cada 1 minuto (executa monitores + tarefas pendentes)
SELECT cron.schedule(
  'run-queue-every-1min',
  '* * * * *',
  $$
  SELECT net.http_post(
    url:='<APP_URL>/api/public/hooks/run-queue',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);

-- Keepalive das sessões do X: a cada 15 minutos
SELECT cron.schedule(
  'session-keepalive-15min',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url:='<APP_URL>/api/public/hooks/session-keepalive',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);

-- Conferir agendamentos:
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
