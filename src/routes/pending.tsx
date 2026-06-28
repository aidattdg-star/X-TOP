import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Clock, ShieldCheck, XCircle, LogOut, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/pending")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", data.user.id)
      .maybeSingle();
    // Já aprovado? Manda direto pro app.
    if (profile?.status === "approved") throw redirect({ to: "/dashboard" });
  },
  component: PendingPage,
});

function PendingPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("pending");
  const [checking, setChecking] = useState(false);

  async function refresh() {
    setChecking(true);
    try {
      const { data } = await supabase.auth.getUser();
      setEmail(data.user?.email ?? null);
      if (!data.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("status")
        .eq("id", data.user.id)
        .maybeSingle();
      const s = profile?.status ?? "pending";
      setStatus(s);
      if (s === "approved") navigate({ to: "/dashboard" });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000); // revalida a cada 20s
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const rejected = status === "rejected";

  return (
    <div className="min-h-screen grid place-items-center bg-background p-8">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-brand/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 right-0 h-72 w-72 rounded-full bg-brand-2/15 blur-3xl" />

      <div className="relative w-full max-w-md text-center space-y-6 border border-border bg-surface rounded-2xl p-10">
        <div
          className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl ${
            rejected ? "bg-destructive/15 text-destructive" : "bg-accent text-brand"
          }`}
        >
          {rejected ? <XCircle className="h-7 w-7" /> : <Clock className="h-7 w-7" />}
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">MimixLab</p>
          <h1 className="mt-2 text-2xl font-light text-foreground">
            {rejected ? "Acesso não aprovado" : "Aguardando aprovação"}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            {rejected ? (
              <>
                Seu cadastro não foi liberado pelo administrador. Fale com o suporte se achar que é
                um engano.
              </>
            ) : (
              <>
                Sua conta <span className="text-foreground">{email}</span> foi criada e está
                aguardando a aprovação de um administrador. Você receberá acesso assim que for
                liberada.
              </>
            )}
          </p>
        </div>

        {!rejected && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-brand" />
            Verificação automática a cada 20s
          </div>
        )}

        <div className="flex items-center justify-center gap-2 pt-2">
          {!rejected && (
            <Button variant="outline" onClick={refresh} disabled={checking} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} />
              {checking ? "Verificando…" : "Verificar agora"}
            </Button>
          )}
          <Button variant="ghost" onClick={signOut} className="gap-2 text-muted-foreground">
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}
