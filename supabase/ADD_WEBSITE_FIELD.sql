-- Adiciona 'website' ao enum profile_field para registrar trocas de link da bio.
-- Rodar no SQL Editor do Supabase. Seguro rodar mais de uma vez.
-- Obs.: ALTER TYPE ... ADD VALUE não pode rodar dentro de transação/bloco;
-- execute esta linha sozinha.
ALTER TYPE public.profile_field ADD VALUE IF NOT EXISTS 'website';
