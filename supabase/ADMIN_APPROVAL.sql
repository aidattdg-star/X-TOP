-- =====================================================================
-- Área de Admin + aprovação de cadastros novos
-- Cada usuário do Auth ganha um "profile" com status (pending/approved/
-- rejected) e role (user/admin). Cadastros novos entram como "pending"
-- e só acessam o app depois que um admin aprovar.
-- Cole TODO este conteúdo no Supabase -> SQL Editor -> Run. Idempotente.
-- =====================================================================

-- ---------- TABELA profiles ----------
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text,
  status      text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  role        text NOT NULL DEFAULT 'user',       -- user | admin
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid
);

-- Usuários que JÁ existem hoje continuam com acesso (não trancar ninguém de fora).
INSERT INTO public.profiles (id, email, status, role, approved_at)
SELECT u.id, u.email, 'approved', 'user', now()
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- ---------- Helpers (SECURITY DEFINER: evitam recursão de RLS) ----------
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = uid AND p.role = 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_approved(uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = uid AND p.status = 'approved');
$$;

-- ---------- Trigger: novo usuário -> profile pending ----------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, status, role)
  VALUES (NEW.id, NEW.email, 'pending', 'user')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------- RLS ----------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- usuário lê o próprio profile; admin lê todos
DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin(auth.uid()));

-- admin atualiza qualquer profile (as ações do app passam pelo service_role,
-- mas mantemos a política como defesa extra)
DROP POLICY IF EXISTS profiles_admin_update ON public.profiles;
CREATE POLICY profiles_admin_update ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- =====================================================================
-- BOOTSTRAP DOS ADMINS
-- >>> Liste aqui os e-mails que devem ser admin (precisam já ter se cadastrado) <<<
-- Promove quem já existe e, se o profile ainda não existir, cria como admin.
-- =====================================================================
INSERT INTO public.profiles (id, email, status, role, approved_at)
SELECT u.id, u.email, 'approved', 'admin', now()
FROM auth.users u
WHERE u.email IN (
  'aidattdg@gmail.com',
  'kelly-bassan@tuamaeaquelaurssa.com'
)
ON CONFLICT (id) DO UPDATE
  SET role = 'admin', status = 'approved', approved_at = now();

NOTIFY pgrst, 'reload schema';
-- Pronto. profiles + trigger + RLS criados e o primeiro admin definido.
