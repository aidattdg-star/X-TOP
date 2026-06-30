import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { EyeOff, Loader2, RefreshCw, ShieldCheck, CheckCircle2, AlertTriangle, Unlock } from "lucide-react";
import { checkShadowban } from "@/lib/account-profile.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/quarantine")({
  component: QuarantinePage,
});

type Acc = { id: string; username: string; shadowban_at: string | null; profile_picture_url: string | null };

const REST_DAYS = 7; // descanso recomendado pra sair do shadowban

function daysSince(iso?: string | null): number {
  if (!iso) return 0;
  return Math.max(0, (Date.now() - Date.parse(iso)) / 86400000);
}
function fmtAgo(iso?: string | null): string {
  if (!iso) return "—";
  const h = (Date.now() - Date.parse(iso)) / 3600000;
  if (h < 1) return `há ${Math.max(1, Math.round(h * 60))}min`;
  if (h < 24) return `há ${Math.round(h)}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function QuarantinePage() {
  const qc = useQueryClient();
  const runCheck = useServerFn(checkShadowban);
  const [busy, setBusy] = useState<string | null>(null);
  const [checkingAll, setCheckingAll] = useState(false);
  const [releasingAll, setReleasingAll] = useState(false);

  const { data: accounts = [] } = useQuery<Acc[]>({
    queryKey: ["quarantine-accounts"],
    refetchInterval: 20000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("twitter_accounts")
        .select("id, username, shadowban_at, profile_picture_url")
        .not("shadowban_at", "is", null)
        .order("shadowban_at", { ascending: true });
      return (data ?? []) as Acc[];
    },
  });

  async function recheck(ids: string[], label?: string) {
    if (!ids.length) return;
    if (ids.length === 1) setBusy(ids[0]); else setCheckingAll(true);
    let saiu = 0, ainda = 0;
    try {
      for (let i = 0; i < ids.length; i += 10) {
        const r = await runCheck({ data: { accountIds: ids.slice(i, i + 10) } });
        saiu += r.ok; ainda += r.shadowban;
        qc.invalidateQueries({ queryKey: ["quarantine-accounts"] });
        qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
      }
      if (saiu) toast.success(`${saiu} conta(s) saíram do shadowban ✓${ainda ? ` · ${ainda} ainda em shadowban` : ""}`);
      else toast.message(label ?? `Ainda em shadowban (${ainda}). Continue descansando.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao verificar");
    } finally {
      setBusy(null); setCheckingAll(false);
    }
  }

  async function releaseAll() {
    const ids = accounts.map((a) => a.id);
    if (!ids.length) return;
    if (!confirm(`Liberar TODAS as ${ids.length} conta(s) da quarentena de uma vez? Elas voltam a ser usadas nas ações mesmo se ainda estiverem em shadowban (use por sua conta e risco).`)) return;
    setReleasingAll(true);
    try {
      const { error } = await supabase.from("twitter_accounts").update({ shadowban_at: null } as never).in("id", ids);
      if (error) throw error;
      toast.success(`${ids.length} conta(s) liberadas da quarentena`);
      qc.invalidateQueries({ queryKey: ["quarantine-accounts"] });
      qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao liberar");
    } finally {
      setReleasingAll(false);
    }
  }

  async function release(id: string, username: string) {
    if (!confirm(`Liberar @${username} da quarentena manualmente? Ela volta a ser usada nas ações (faça só se tiver certeza que saiu do shadowban).`)) return;
    setBusy(id);
    try {
      const { error } = await supabase.from("twitter_accounts").update({ shadowban_at: null } as never).eq("id", id);
      if (error) throw error;
      toast.success(`@${username} liberada`);
      qc.invalidateQueries({ queryKey: ["quarantine-accounts"] });
      qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Recuperação"
        title="Quarentena (shadowban)"
        description="Contas em shadowban descansam aqui até voltarem ao normal. Enquanto estão na quarentena, NÃO são usadas em nenhuma ação."
        actions={
          accounts.length > 0 ? (
            <>
              <Button variant="outline" onClick={() => recheck(accounts.map((a) => a.id))} disabled={checkingAll || releasingAll}>
                {checkingAll ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Re-verificar todas
              </Button>
              <Button onClick={releaseAll} disabled={releasingAll || checkingAll} className="bg-amber-500/90 hover:bg-amber-500 text-black">
                {releasingAll ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Unlock className="h-4 w-4 mr-2" />}
                Liberar todas
              </Button>
            </>
          ) : undefined
        }
      />

      {/* Guia de recuperação */}
      <div className="mt-8 liquid-glass rounded-2xl p-5">
        <div className="relative flex items-center gap-2.5 mb-3">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06] border border-white/10 text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
          </span>
          <p className="text-sm font-medium text-foreground">Como tirar uma conta do shadowban</p>
        </div>
        <div className="relative grid md:grid-cols-2 gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
          <p>① <b className="text-foreground">Parar tudo</b> — a conta fica parada aqui (já é automático).</p>
          <p>② <b className="text-foreground">Descansar {REST_DAYS} dias</b> — pouca/nenhuma atividade. Às vezes leva até 2–3 semanas.</p>
          <p>③ <b className="text-foreground">Apagar tweets</b> recentes spammy/duplicados.</p>
          <p>④ <b className="text-foreground">Verificar telefone e e-mail</b> da conta no X.</p>
          <p>⑤ Voltar com <b className="text-foreground">conteúdo original</b>, sem links/hashtags no começo.</p>
          <p>⑥ Usar <b className="text-foreground">IP residencial</b> limpo (proxy bom).</p>
        </div>
        <p className="relative mt-3 text-[11px] text-muted-foreground">
          Clique <b className="text-foreground">Re-verificar</b> de vez em quando — quando a conta sair do shadowban, ela é liberada automaticamente.
        </p>
      </div>

      {/* Lista */}
      {accounts.length === 0 ? (
        <div className="mt-6 liquid-glass rounded-2xl p-10 text-center">
          <ShieldCheck className="h-6 w-6 text-emerald-400 mx-auto mb-3" />
          <p className="text-sm text-foreground">Nenhuma conta em quarentena 🎉</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Rode <b>Verificar shadowban</b> em Contas &amp; Proxies pra detectar contas afetadas.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {accounts.map((a) => {
            const d = daysSince(a.shadowban_at);
            const pct = Math.min(100, Math.round((d / REST_DAYS) * 100));
            const ready = d >= REST_DAYS;
            return (
              <div key={a.id} className="liquid-glass rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="h-9 w-9 shrink-0 rounded-full overflow-hidden bg-white/[0.06] grid place-items-center text-[10px] text-muted-foreground uppercase ring-1 ring-amber-400/20">
                    {a.profile_picture_url ? (
                      <img src={a.profile_picture_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      a.username.slice(0, 2)
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate flex items-center gap-1.5">
                      <EyeOff className="h-3.5 w-3.5 text-amber-400 shrink-0" /> @{a.username}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      em quarentena {fmtAgo(a.shadowban_at)} · descanso {Math.floor(d)}/{REST_DAYS}d
                    </p>
                    <div className="mt-1.5 h-1 rounded-full bg-white/[0.06] overflow-hidden max-w-[220px]">
                      <div className={cn("h-full rounded-full", ready ? "bg-emerald-400" : "bg-amber-400")} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {ready && <span className="hidden sm:flex text-[11px] text-emerald-300/90 items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> pronto p/ testar</span>}
                  <Button size="sm" variant="outline" onClick={() => recheck([a.id])} disabled={busy === a.id}>
                    {busy === a.id ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                    Re-verificar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => release(a.id, a.username)} disabled={busy === a.id} className="text-muted-foreground">
                    Liberar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
