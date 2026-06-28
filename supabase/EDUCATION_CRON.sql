-- =====================================================================
-- Agendador da EDUCAÇÃO de contas (pg_cron).
-- Sem isto, o endpoint /api/public/hooks/education NUNCA é chamado e nenhuma
-- conta curte nada (era o motivo de "0 curtidas").
--
-- 1) Troque <APP_URL> pela MESMA URL que você usou no WORKER_CRON.sql
--    (ex.: https://x-top-one.vercel.app) — SEM barra no final.
-- 2) Cole no Supabase -> SQL Editor -> Run.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- idempotente
SELECT cron.unschedule('education-every-2min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='education-every-2min');

-- Educação: a cada 2 minutos (descobre tweets por palavra-chave e processa
-- a fila de curtidas — 5 por execução, com gap humano de 2:30 entre elas).
SELECT cron.schedule(
  'education-every-2min',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url:='<APP_URL>/api/public/hooks/education',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:='{}'::jsonb
  );
  $$
);

-- Conferir agendamentos:
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
