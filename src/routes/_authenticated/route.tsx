import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });

    // Gate de aprovação: só entra quem tem profile aprovado.
    // Fail-open: se a consulta der ERRO (ex.: tabela 'profiles' ainda não criada
    // no Supabase), liberamos o acesso pra não trancar ninguém por engano. O
    // bloqueio só acontece quando há resposta válida e o status não é 'approved'.
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", data.user.id)
      .maybeSingle();
    if (!profileErr && (!profile || profile.status !== "approved")) {
      throw redirect({ to: "/pending" });
    }

    return { user: data.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
