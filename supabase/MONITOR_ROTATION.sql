-- =====================================================================
-- Rodízio entre contas no monitoramento.
-- Guarda em qual conta o rodízio está e quantas ações ela já fez.
-- Cole no Supabase -> SQL Editor -> Run. Seguro rodar mais de uma vez.
-- =====================================================================

ALTER TABLE public.flow_monitor_state
  ADD COLUMN IF NOT EXISTS rotate_index int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rotate_count int NOT NULL DEFAULT 0;
