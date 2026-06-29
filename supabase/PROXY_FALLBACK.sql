-- =====================================================================
-- Pool GLOBAL de proxies (fallback compartilhado entre todos os usuários).
-- Quando o proxy da conta está morto/faltando, o sistema chama esta função
-- e pega UM proxy saudável de QUALQUER usuário — sem expor a tabela inteira
-- (SECURITY DEFINER devolve só 1 proxy por chamada).
-- Cole no Supabase -> SQL Editor -> Run. Seguro rodar de novo.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.pick_fallback_proxy()
RETURNS TABLE (ip text, port int, username text, password text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.ip, p.port, p.username, p.password
  FROM public.proxies p
  WHERE p.status = 'active'
    AND (p.quality IS NULL OR p.quality <> 'dead')
  ORDER BY random()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.pick_fallback_proxy() TO authenticated, service_role;
