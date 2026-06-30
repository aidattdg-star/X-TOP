import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ProxyModal } from "@/components/accounts/proxy-modal";
import { AccountModal } from "@/components/accounts/account-modal";
import { EditProfileModal } from "@/components/accounts/edit-profile-modal";
import { Badge } from "@/components/ui/badge";
import { Server, AtSign, Loader2, Trash2, Send, ChevronLeft, Folder, FolderOpen, Layers, Ban, Plus, Activity, EyeOff, Flame, Zap } from "lucide-react";
import { toast } from "sonner";
import { testTwitterAccount, testPostTweets } from "@/lib/accounts.functions";
import { testAccountsOnline, checkShadowban, syncFollowerCounts } from "@/lib/account-profile.functions";
import { testProxyConnection } from "@/lib/proxies.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/accounts")({
  component: AccountsPage,
});

function fmtFollowers(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "k";
  return String(n);
}

function AccountsPage() {
  const qc = useQueryClient();
  const [proxyOpen, setProxyOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<{ id: string; username: string; display_name: string | null } | null>(null);
  const [testingAcc, setTestingAcc] = useState<string | null>(null);
  const [postingAcc, setPostingAcc] = useState<string | null>(null);
  const runTestAccount = useServerFn(testTwitterAccount);
  const runTestProxy = useServerFn(testProxyConnection);
  const runTestPost = useServerFn(testPostTweets);
  const runTestAccountsOnline = useServerFn(testAccountsOnline);
  const runCheckShadowban = useServerFn(checkShadowban);
  const runSyncFollowers = useServerFn(syncFollowerCounts);
  const [testingAccounts, setTestingAccounts] = useState(false);
  const [acctTestDone, setAcctTestDone] = useState({ done: 0, total: 0, die: 0 });
  const [checkingSb, setCheckingSb] = useState(false);
  const [sbDone, setSbDone] = useState({ done: 0, total: 0, sb: 0 });
  const [syncingFollowers, setSyncingFollowers] = useState(false);
  const [releasingRefresh, setReleasingRefresh] = useState(false);

  // Tira as contas do refresh (zera cooldown + cota) pra poder usar de novo já.
  async function releaseRefresh() {
    const ids = (accounts ?? [])
      .filter((a: any) => a.cooldown_until && Date.parse(a.cooldown_until) > Date.now())
      .map((a: any) => a.id as string);
    if (!ids.length) return toast.info("Nenhuma conta em refresh agora.");
    if (!confirm(`Tirar ${ids.length} conta(s) do refresh (cooldown pós-RT)? Elas voltam a ser usadas imediatamente.`)) return;
    setReleasingRefresh(true);
    try {
      const { error } = await supabase
        .from("twitter_accounts")
        .update({ cooldown_until: null, rt_count: 0, like_count: 0 } as never)
        .in("id", ids);
      if (error) {
        // colunas rt_count/like_count podem não existir — tenta só o cooldown
        const { error: e2 } = await supabase
          .from("twitter_accounts").update({ cooldown_until: null } as never).in("id", ids);
        if (e2) throw e2;
      }
      toast.success(`${ids.length} conta(s) liberadas do refresh — já dá pra usar.`);
      qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao liberar refresh");
    } finally {
      setReleasingRefresh(false);
    }
  }

  // Verifica shadowban (search ban) em lotes; quem estiver em shadowban vai pra Quarentena.
  async function checkAllShadowban() {
    const ids = (accounts ?? []).filter((a: any) => a.status !== "banned").map((a: any) => a.id as string);
    if (!ids.length) return toast.info("Nenhuma conta pra verificar.");
    if (!confirm(`Verificar shadowban em ${ids.length} conta(s)? As que estiverem em shadowban vão pra "Quarentena". (testa quem tem tweets recentes)`)) return;
    setCheckingSb(true);
    setSbDone({ done: 0, total: ids.length, sb: 0 });
    let sb = 0, ok = 0, semTweets = 0, erro = 0;
    try {
      for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        try {
          const r = await runCheckShadowban({ data: { accountIds: chunk } });
          sb += r.shadowban; ok += r.ok; semTweets += r.sem_tweets; erro += r.erro;
        } catch { /* lote falhou — segue */ }
        setSbDone({ done: Math.min(i + 10, ids.length), total: ids.length, sb });
        qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
      }
      toast.success(`Shadowban: ${sb} em quarentena · ${ok} ok · ${semTweets} sem tweets${erro ? ` · ${erro} erro` : ""}`);
    } finally {
      setCheckingSb(false);
    }
  }

  async function handleSyncFollowers() {
    setSyncingFollowers(true);
    try {
      const r = await runSyncFollowers({ data: {} });
      if (r.updated > 0) {
        toast.success(`Seguidores sincronizados: ${r.updated} conta(s)${r.errors ? ` · ${r.errors} erro(s)` : ""}`);
      } else if (r.errors > 0) {
        toast.error(`Falhou em todas (${r.errors}). ${(r as any).errSamples?.[0] ?? ""}`);
      } else {
        toast.info(`Nenhuma conta atualizada (${(r as any).total ?? 0} testadas, ${(r as any).skipped ?? 0} sem tokens).`);
      }
      qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar");
    } finally {
      setSyncingFollowers(false);
    }
  }

  // Testa TODAS as contas (não-banidas) em lotes; quem der die vai pra Suspensas.
  async function testAllAccounts() {
    const ids = (accounts ?? []).filter((a: any) => a.status !== "banned").map((a: any) => a.id as string);
    if (!ids.length) return toast.info("Nenhuma conta pra testar.");
    if (!confirm(`Testar ${ids.length} conta(s) DE VERDADE? Cada conta posta um tweet curto e apaga na hora — assim conta suspensa/bloqueada (que finge estar online na leitura) é detectada. As que caírem vão pra "Suspensas".`)) return;
    setTestingAccounts(true);
    setAcctTestDone({ done: 0, total: ids.length, die: 0 });
    let die = 0, online = 0, erro = 0;
    try {
      for (let i = 0; i < ids.length; i += 12) {
        const chunk = ids.slice(i, i + 12);
        try {
          const r = await runTestAccountsOnline({ data: { accountIds: chunk } });
          die += r.die; online += r.online; erro += r.erro;
        } catch { /* lote falhou — segue */ }
        setAcctTestDone({ done: Math.min(i + 12, ids.length), total: ids.length, die });
        qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
      }
      toast.success(`Teste: ${online} online · ${die} caíram (→ Suspensas)${erro ? ` · ${erro} instável(is)` : ""}`);
    } finally {
      setTestingAccounts(false);
    }
  }

  async function testAccount(id: string) {
    setTestingAcc(id);
    try {
      const res = await runTestAccount({ data: { account_id: id } });
      toast.success(`Conectado como @${res.screen_name}${res.name ? ` (${res.name})` : ""}`);
      qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao testar conta");
      qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
    } finally {
      setTestingAcc(null);
    }
  }

  async function postTest(id: string) {
    setPostingAcc(id);
    try {
      const res = await runTestPost({ data: { account_id: id } });
      const okUrl = res.results.find((r) => r.ok)?.url;
      if (res.ok_count === res.total) {
        toast.success(`@${res.username}: ${res.ok_count}/${res.total} postados ✓`, {
          description: okUrl ? "Clique pra ver no X" : undefined,
          action: okUrl ? { label: "Ver", onClick: () => window.open(okUrl, "_blank") } : undefined,
        });
      } else if (res.ok_count > 0) {
        toast.warning(`@${res.username}: ${res.ok_count}/${res.total} postados`, {
          description: res.results.find((r) => !r.ok)?.error?.slice(0, 120),
        });
      } else {
        toast.error(`@${res.username}: falhou — ${res.results[0]?.error?.slice(0, 140) ?? "erro"}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao postar teste");
    } finally {
      setPostingAcc(null);
    }
  }

  const { data: proxies } = useQuery({
    queryKey: ["proxies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proxies")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: accounts } = useQuery({
    queryKey: ["twitter_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("twitter_accounts")
        .select("*, proxy:proxies(*)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: folders } = useQuery({
    queryKey: ["account_folders"],
    queryFn: async () => {
      const { data } = await supabase.from("account_folders").select("id, name").order("name");
      return data ?? [];
    },
  });
  // Contas em "refresh" (cooldown pós-RT/like) — descansam 60min antes de novo uso.
  const refreshCount = (accounts ?? []).filter(
    (a: any) => a.cooldown_until && Date.parse(a.cooldown_until) > Date.now(),
  ).length;

  // null = visão de pastas (cards). "__all__"/"__none__"/id = vendo contas de uma pasta.
  const [folderFilter, setFolderFilter] = useState<string | null>(null);

  async function moveAccount(accountId: string, folderId: string | null) {
    const { error } = await supabase
      .from("twitter_accounts").update({ folder_id: folderId }).eq("id", accountId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
  }

  async function createFolder() {
    const name = prompt("Nome da nova pasta:")?.trim();
    if (!name) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return toast.error("Não autenticado");
    // Reaproveita se já existir uma pasta com o mesmo nome.
    const { data: existing } = await supabase
      .from("account_folders").select("id").eq("user_id", u.user.id).eq("name", name).maybeSingle();
    if (existing) {
      toast.info(`A pasta "${name}" já existe`);
      qc.invalidateQueries({ queryKey: ["account_folders"] });
      return;
    }
    const { error } = await supabase.from("account_folders").insert({ user_id: u.user.id, name });
    if (error) return toast.error(error.message);
    toast.success(`Pasta "${name}" criada`);
    qc.invalidateQueries({ queryKey: ["account_folders"] });
  }

  async function deleteFolder(folderId: string, name: string) {
    if (!confirm(`Apagar a pasta "${name}"? As contas dela voltam para "Sem pasta" (não são removidas).`)) return;
    const { error } = await supabase.from("account_folders").delete().eq("id", folderId);
    if (error) return toast.error(error.message);
    toast.success(`Pasta "${name}" apagada`);
    if (folderFilter === folderId) setFolderFilter(null);
    qc.invalidateQueries({ queryKey: ["account_folders"] });
    qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
  }

  async function testProxy(id: string) {
    setTesting(id);
    try {
      const res = await runTestProxy({ data: { proxy_id: id } });
      const q = (res as any).quality as string | undefined;
      if (res.status === "active") {
        // Qualquer proxy que responde é usável (fica no Live). Rótulo é só informativo.
        const tag = q === "datacenter" ? " · datacenter (usável, +arriscado)" : q === "slow" ? " · lento" : "";
        toast.success(`Proxy OK · usável${tag} · ${res.latency_ms}ms${res.exit_ip ? ` · IP ${res.exit_ip}` : ""}`);
      } else {
        toast.error(`Proxy falhou${res.detail ? `: ${res.detail}` : ""}`);
      }
      qc.invalidateQueries({ queryKey: ["proxies"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no teste");
    } finally {
      setTesting(null);
    }
  }

  const [testingAll, setTestingAll] = useState(false);
  const [testAllDone, setTestAllDone] = useState(0);
  const [proxyTab, setProxyTab] = useState<"nova" | "live" | "bad" | "die">("live");

  async function deleteManyProxies(ids: string[], kind: string) {
    if (!ids.length) return;
    if (!confirm(`Remover as ${ids.length} proxy(s) ${kind}? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from("proxies").delete().in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`${ids.length} proxy(s) removida(s)`);
    qc.invalidateQueries({ queryKey: ["proxies"] });
    qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
  }
  async function testProxies(list: any[]) {
    if (!list?.length) return;
    setTestingAll(true);
    setTestAllDone(0);
    try {
      for (let i = 0; i < list.length; i++) {
        try { await runTestProxy({ data: { proxy_id: list[i].id } }); } catch { /* segue */ }
        setTestAllDone(i + 1);
      }
      qc.invalidateQueries({ queryKey: ["proxies"] });
      toast.success(`${list.length} proxy(s) testada(s)`);
    } finally {
      setTestingAll(false);
    }
  }

  async function deleteProxy(id: string) {
    if (!confirm("Remover este proxy?")) return;
    const { error } = await supabase.from("proxies").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["proxies"] });
    qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
  }

  async function deleteAccount(id: string) {
    if (!confirm("Remover esta conta?")) return;
    const { error } = await supabase.from("twitter_accounts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
  }

  // Limpa o sinalizador de "conta limitada" depois que você verificou (telefone/captcha).
  async function clearLimited(id: string) {
    const { error } = await supabase
      .from("twitter_accounts")
      .update({ limited_at: null })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Conta desmarcada — pode testar o RT de novo");
    qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
  }

  const [deletingAll, setDeletingAll] = useState(false);
  async function deleteAllAccounts() {
    if (!accounts?.length) return;
    if (!confirm(`Remover TODAS as ${accounts.length} contas do X? Esta ação não pode ser desfeita.`)) return;
    setDeletingAll(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const { error } = await supabase.from("twitter_accounts").delete().eq("user_id", u.user.id);
      if (error) throw error;
      toast.success("Todas as contas foram removidas");
      qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao remover");
    } finally {
      setDeletingAll(false);
    }
  }

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-7xl mx-auto">
      <PageHeader
        eyebrow="Operação"
        title="Contas & Proxies"
        description="Isolamento máximo: cada conta do X opera através de um proxy dedicado."
        actions={
          <>
            <Button variant="outline" onClick={testAllAccounts} disabled={testingAccounts || !accounts?.length}>
              {testingAccounts ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Activity className="h-4 w-4 mr-2" strokeWidth={1.5} />}
              {testingAccounts ? `Testando ${acctTestDone.done}/${acctTestDone.total}${acctTestDone.die ? ` · ${acctTestDone.die} die` : ""}` : "Testar contas"}
            </Button>
            <Button variant="outline" onClick={checkAllShadowban} disabled={checkingSb || !accounts?.length}>
              {checkingSb ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <EyeOff className="h-4 w-4 mr-2" strokeWidth={1.5} />}
              {checkingSb ? `Shadowban ${sbDone.done}/${sbDone.total}${sbDone.sb ? ` · ${sbDone.sb}` : ""}` : "Verificar shadowban"}
            </Button>
            <Button variant="outline" onClick={handleSyncFollowers} disabled={syncingFollowers || !accounts?.length}>
              {syncingFollowers ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Flame className="h-4 w-4 mr-2" strokeWidth={1.5} />}
              {syncingFollowers ? "Sincronizando..." : "Sync seguidores"}
            </Button>
            {refreshCount > 0 && (
              <Button variant="outline" onClick={releaseRefresh} disabled={releasingRefresh} className="border-amber-500/40 text-amber-600 dark:text-amber-400">
                {releasingRefresh ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" strokeWidth={1.5} />}
                {releasingRefresh ? "Liberando..." : `Tirar do refresh (${refreshCount})`}
              </Button>
            )}
            <Button variant="outline" onClick={() => setProxyOpen(true)}>
              <Server className="h-4 w-4 mr-2" strokeWidth={1.5} /> Novo proxy
            </Button>
            <Button onClick={() => setAccountOpen(true)} disabled={!proxies?.length}>
              <AtSign className="h-4 w-4 mr-2" strokeWidth={1.5} /> Nova conta X
            </Button>
          </>
        }
      />

      <section className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Contas do X</h2>
          <span className="text-xs text-muted-foreground">{accounts?.length ?? 0} contas</span>
        </div>

        {/* VISÃO DE PASTAS (cards) — padrão, pra não empilhar todas as contas.
            Contas suspensas (caídas) saem das contagens normais e vão pro card "Suspensas". */}
        {accounts && accounts.length > 0 && folderFilter === null && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <FolderCard
              label="Todas as contas"
              count={accounts.filter((a) => (!isSuspended(a) && !isQuarantine(a))).length}
              onClick={() => setFolderFilter("__all__")}
              all
            />
            {accounts.some((a) => (!isSuspended(a) && !isQuarantine(a)) && !(a as any).folder_id) && (
              <FolderCard
                label="Sem pasta"
                count={accounts.filter((a) => (!isSuspended(a) && !isQuarantine(a)) && !(a as any).folder_id).length}
                onClick={() => setFolderFilter("__none__")}
              />
            )}
            {(folders ?? []).map((f) => (
              <FolderCard
                key={f.id}
                label={f.name}
                count={accounts.filter((a) => (!isSuspended(a) && !isQuarantine(a)) && (a as any).folder_id === f.id).length}
                onClick={() => setFolderFilter(f.id)}
                onDelete={() => deleteFolder(f.id, f.name)}
              />
            ))}
            {accounts.some(isSuspended) && (
              <FolderCard
                label="Suspensas"
                count={accounts.filter(isSuspended).length}
                onClick={() => setFolderFilter("__banned__")}
                suspended
              />
            )}
            {accounts.some(isQuarantine) && (
              <FolderCard
                label="Shadowban"
                count={accounts.filter(isQuarantine).length}
                onClick={() => setFolderFilter("__quarantine__")}
                quarantine
              />
            )}
            <button
              type="button"
              onClick={createFolder}
              className="group flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-brand/40 text-brand hover:bg-brand/[0.06] transition-colors min-h-[96px] p-4"
            >
              <Plus className="h-5 w-5" />
              <span className="text-xs font-medium">Nova pasta</span>
            </button>
          </div>
        )}

        {/* DENTRO DE UMA PASTA: voltar + trocar rápido */}
        {accounts && accounts.length > 0 && folderFilter !== null && (
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <button
              onClick={() => setFolderFilter(null)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-lg border border-border px-3 py-1.5 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Pastas
            </button>
            <FolderPill label="Todas" count={accounts.filter((a) => (!isSuspended(a) && !isQuarantine(a))).length} active={folderFilter === "__all__"} onClick={() => setFolderFilter("__all__")} />
            <FolderPill
              label="Sem pasta"
              count={accounts.filter((a) => (!isSuspended(a) && !isQuarantine(a)) && !(a as any).folder_id).length}
              active={folderFilter === "__none__"}
              onClick={() => setFolderFilter("__none__")}
            />
            {(folders ?? []).map((f) => (
              <FolderPill
                key={f.id}
                label={f.name}
                count={accounts.filter((a) => (!isSuspended(a) && !isQuarantine(a)) && (a as any).folder_id === f.id).length}
                active={folderFilter === f.id}
                onClick={() => setFolderFilter(f.id)}
                onDelete={() => deleteFolder(f.id, f.name)}
              />
            ))}
            {accounts.some(isSuspended) && (
              <FolderPill
                label="Suspensas"
                count={accounts.filter(isSuspended).length}
                active={folderFilter === "__banned__"}
                onClick={() => setFolderFilter("__banned__")}
              />
            )}
            {accounts.some(isQuarantine) && (
              <FolderPill
                label="Shadowban"
                count={accounts.filter(isQuarantine).length}
                active={folderFilter === "__quarantine__"}
                onClick={() => setFolderFilter("__quarantine__")}
              />
            )}
            <button
              type="button"
              onClick={createFolder}
              title="Criar nova pasta"
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-brand/40 text-brand hover:bg-brand/10 px-3 py-1 text-xs transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Nova pasta
            </button>
          </div>
        )}

        {(!accounts || accounts.length === 0) && (
          <div className="border border-dashed border-border rounded-lg p-12 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhuma conta cadastrada. {proxies?.length ? "Adicione uma nova conta." : "Cadastre primeiro um proxy."}
            </p>
          </div>
        )}

        {folderFilter !== null && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts
            ?.filter((acc) =>
              folderFilter === "__banned__"
                ? isSuspended(acc)
                : folderFilter === "__quarantine__"
                  ? isQuarantine(acc)
                  : isSuspended(acc) || isQuarantine(acc)
                    ? false
                    : folderFilter === "__all__"
                      ? true
                      : folderFilter === "__none__"
                        ? !(acc as any).folder_id
                        : (acc as any).folder_id === folderFilter,
            )
            .map((acc) => (
            <div key={acc.id} className="border border-border bg-surface rounded-lg p-5">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center text-sm font-medium text-foreground overflow-hidden">
                  {acc.profile_picture_url ? (
                    <img src={acc.profile_picture_url} alt={acc.username} className="h-full w-full object-cover" />
                  ) : (
                    acc.username.slice(0, 2).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">@{acc.username}</p>
                  <p className="text-xs text-muted-foreground truncate">{acc.display_name || "—"}</p>
                  {(acc as any).follower_count != null && (
                    <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-foreground/80">
                      <Flame className="h-3 w-3 text-orange-400" strokeWidth={2} />
                      <b className="tabular-nums">{fmtFollowers(Number((acc as any).follower_count))}</b>
                      <span className="text-muted-foreground">seguidores</span>
                    </span>
                  )}
                  {(acc as any).limited_at && (
                    <span
                      title="O X aceitou o like mas descartou o RT. Verifique a conta (telefone/captcha) e clique em 'Já verifiquei'."
                      className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-400"
                    >
                      ⚠ Limitada · verificar
                    </span>
                  )}
                </div>
                <StatusDot status={acc.status} />
              </div>

              <div className="mt-4 pt-4 border-t border-border space-y-1">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Proxy</p>
                {(acc as any).proxy ? (
                  <p className="text-xs text-foreground font-mono">
                    {(acc as any).proxy.ip}:{(acc as any).proxy.port}
                  </p>
                ) : (
                  <p className="text-xs text-destructive">Sem proxy</p>
                )}
              </div>

              <div className="mt-3 pt-3 border-t border-border space-y-1">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Pool</p>
                <PoolStatus
                  lastUsedAt={(acc as any).last_used_at}
                  cooldownUntil={(acc as any).cooldown_until}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2 items-center">
                <button
                  onClick={() => testAccount(acc.id)}
                  disabled={testingAcc === acc.id}
                  className="text-xs text-foreground hover:underline disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {testingAcc === acc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Testar
                </button>
                <button
                  onClick={() => postTest(acc.id)}
                  disabled={postingAcc === acc.id}
                  title="Posta 2 tweets 'hello world' pra confirmar que a conta consegue publicar"
                  className="text-xs text-foreground hover:underline disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {postingAcc === acc.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  Postar teste
                </button>
                <button
                  onClick={() => setEditingAccount({ id: acc.id, username: acc.username, display_name: acc.display_name })}
                  className="text-xs text-foreground hover:underline"
                >
                  Editar perfil
                </button>
                {(acc as any).limited_at && (
                  <button
                    onClick={() => clearLimited(acc.id)}
                    className="text-xs text-amber-400 hover:underline"
                  >
                    Já verifiquei
                  </button>
                )}
                <select
                  value={(acc as any).folder_id ?? ""}
                  onChange={(e) => moveAccount(acc.id, e.target.value || null)}
                  title="Mover para pasta"
                  className="ml-auto text-xs bg-transparent border border-border rounded px-1.5 py-1 text-muted-foreground hover:text-foreground focus:outline-none max-w-[120px]"
                >
                  <option value="">Sem pasta</option>
                  {(folders ?? []).map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => deleteAccount(acc.id)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                >
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
        )}
      </section>

      <section className="mt-12">
        {(() => {
          const all = proxies ?? [];
          // Mapa proxy_id -> conta que o usa (em uso no momento)
          const usage = new Map<string, { username: string; status: string }>();
          for (const a of accounts ?? []) {
            if ((a as any).proxy_id) usage.set((a as any).proxy_id, { username: a.username, status: a.status });
          }
          const inUseCount = all.filter((p) => usage.has(p.id)).length;
          const nova = all.filter(isNewProxy);
          const die = all.filter((p) => !isNewProxy(p) && isDieProxy(p));
          const bad = all.filter((p) => !isNewProxy(p) && !isDieProxy(p) && isBadProxy(p));
          const live = all.filter((p) => !isNewProxy(p) && !isDieProxy(p) && !isBadProxy(p));
          const shown = proxyTab === "nova" ? nova : proxyTab === "die" ? die : proxyTab === "bad" ? bad : live;
          const removable = proxyTab === "die" ? die : proxyTab === "bad" ? bad : [];
          const emptyMsg =
            proxyTab === "nova" ? "Nenhuma proxy nova — todas já foram testadas."
            : proxyTab === "die" ? "Nenhum proxy morto. 🎉"
            : proxyTab === "bad" ? "Nenhum proxy ruim. 🎉"
            : "Nenhum proxy live ainda — teste as novas.";
          return (
        <>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Proxies</h2>
            <div className="flex gap-1 p-1 rounded-lg bg-muted/40 border border-border">
              <ProxyTab active={proxyTab === "nova"} onClick={() => setProxyTab("nova")}>
                Novas ({nova.length})
              </ProxyTab>
              <ProxyTab active={proxyTab === "live"} onClick={() => setProxyTab("live")}>
                Live ({live.length})
              </ProxyTab>
              <ProxyTab active={proxyTab === "bad"} onClick={() => setProxyTab("bad")}>
                Bad ({bad.length})
              </ProxyTab>
              <ProxyTab active={proxyTab === "die"} onClick={() => setProxyTab("die")}>
                Die ({die.length})
              </ProxyTab>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {inUseCount} em uso
            </span>
          </div>
          <div className="flex items-center gap-2">
            {removable.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => deleteManyProxies(removable.map((p) => p.id), proxyTab)} className="border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground">
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Remover todas {proxyTab} ({removable.length})
              </Button>
            )}
            {shown.length > 0 && (
              <Button
                variant={proxyTab === "nova" ? "default" : "outline"}
                size="sm"
                onClick={() => testProxies(shown)}
                disabled={testingAll}
                className={proxyTab === "nova" ? "gradient-brand text-white border-0" : ""}
              >
                {testingAll ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Testando {testAllDone}/{shown.length}</>
                ) : proxyTab === "nova" ? (
                  <>Testar novas ({shown.length})</>
                ) : (
                  <>Testar {proxyTab} ({shown.length})</>
                )}
              </Button>
            )}
          </div>
        </div>

        {bad.length > 0 && proxyTab === "live" && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            ⚠️ <b>{bad.length} proxy(s) ruim(s)</b> (datacenter/lentas/com falhas) foram movidas pra aba <b>Bad</b>. Elas causam bloqueio (226) — troque por residenciais.
          </div>
        )}

        <div className="border border-border bg-surface rounded-lg overflow-hidden">
          {all.length === 0 && (
            <div className="p-10 text-sm text-muted-foreground text-center">
              Nenhum proxy cadastrado.
            </div>
          )}
          {all.length > 0 && shown.length === 0 && (
            <div className="p-10 text-sm text-muted-foreground text-center">
              {emptyMsg}
            </div>
          )}
          {shown.length > 0 && (
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left px-5 py-3 font-normal">Endereço</th>
                  <th className="text-left px-5 py-3 font-normal">Usuário</th>
                  <th className="text-left px-5 py-3 font-normal">Qualidade</th>
                  <th className="text-left px-5 py-3 font-normal">Em uso</th>
                  <th className="text-left px-5 py-3 font-normal">Status</th>
                  <th className="text-right px-5 py-3 font-normal">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-3 font-mono text-xs">
                      {p.ip}:{p.port}
                      {p.label && <span className="ml-2 text-muted-foreground">· {p.label}</span>}
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{p.username || "—"}</td>
                    <td className="px-5 py-3"><QualityBadge quality={(p as any).quality} latency={(p as any).latency_ms} fails={(p as any).fail_count} /></td>
                    <td className="px-5 py-3">
                      {usage.has(p.id) ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-foreground">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          </span>
                          @{usage.get(p.id)!.username}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">livre</span>
                      )}
                    </td>
                    <td className="px-5 py-3"><StatusDot status={p.status} /></td>
                    <td className="px-5 py-3 text-right space-x-3">
                      <button
                        onClick={() => testProxy(p.id)}
                        disabled={testing === p.id}
                        className="text-xs text-foreground hover:underline disabled:opacity-50"
                      >
                        {testing === p.id ? <Loader2 className="h-3 w-3 inline animate-spin" /> : "Testar"}
                      </button>
                      <button
                        onClick={() => deleteProxy(p.id)}
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
        </>
          );
        })()}
      </section>

      {!!accounts?.length && (
        <button
          onClick={deleteAllAccounts}
          disabled={deletingAll}
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full border border-destructive/40 bg-destructive/15 px-4 py-2.5 text-sm font-medium text-destructive shadow-lg backdrop-blur-md transition-all hover:bg-destructive hover:text-destructive-foreground hover:scale-[1.02] disabled:opacity-60"
          title="Remover todas as contas"
        >
          {deletingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Remover todas as contas
        </button>
      )}

      <ProxyModal open={proxyOpen} onOpenChange={setProxyOpen} />
      <AccountModal open={accountOpen} onOpenChange={setAccountOpen} proxies={proxies ?? []} />
      {editingAccount && (
        <EditProfileModal
          open
          onClose={() => setEditingAccount(null)}
          account={editingAccount}
        />
      )}
    </div>
  );
}

// Die = morto/inalcançável · Bad = conecta mas ruim (datacenter/lento/muitas falhas) · Live = bom.
function isNewProxy(p: any): boolean {
  // recém-adicionada = nunca testada (sem qualidade e sem data de teste)
  return !p?.last_tested_at && !p?.quality;
}
function isDieProxy(p: any): boolean {
  return p?.status === "dead" || p?.quality === "dead";
}
function isBadProxy(p: any): boolean {
  // Proxy que RESPONDE fica no Live (usável). Só vai pra "Bad" quem falha de
  // verdade muitas vezes. Datacenter/lento continuam usáveis — só ganham rótulo.
  return (p?.fail_count ?? 0) >= 5;
}

function ProxyTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-xs font-medium transition-colors",
        active ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function QualityBadge({ quality, latency, fails }: { quality?: string | null; latency?: number | null; fails?: number | null }) {
  if (!quality) return <span className="text-xs text-muted-foreground">— não testado</span>;
  // Legado: "datacenter"/"unknown" vinham do classificador antigo (falso positivo
  // em proxy residencial). Hoje proxy que responde é usável -> mostra como Bom.
  const q0 = quality === "datacenter" || quality === "unknown" ? "good" : quality;
  const map: Record<string, { label: string; cls: string }> = {
    good: { label: "Bom", cls: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10" },
    slow: { label: "Lento", cls: "border-amber-500/40 text-amber-400 bg-amber-500/10" },
    dead: { label: "Morto — troque", cls: "border-red-500/40 text-red-400 bg-red-500/10" },
  };
  const q = map[q0] ?? { label: q0, cls: "border-border text-muted-foreground" };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider ${q.cls}`}>
        {q.label}
      </span>
      {typeof latency === "number" && q0 !== "dead" && (
        <span className="text-[10px] text-muted-foreground tabular-nums">{latency}ms</span>
      )}
      {(fails ?? 0) >= 5 && <span className="text-[10px] text-red-400">{fails} falhas</span>}
    </span>
  );
}

function isSuspended(a: { status?: string | null }): boolean {
  return a?.status === "banned";
}

// Em quarentena = detectada em shadowban (e não banida). Sai das contagens normais.
function isQuarantine(a: { status?: string | null; shadowban_at?: string | null }): boolean {
  return !!a?.shadowban_at && a?.status !== "banned";
}

function FolderCard({
  label,
  count,
  onClick,
  onDelete,
  all,
  suspended,
  quarantine,
}: {
  label: string;
  count: number;
  onClick: () => void;
  onDelete?: () => void;
  all?: boolean;
  suspended?: boolean;
  quarantine?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative text-left rounded-2xl border bg-surface p-4 transition-all hover:-translate-y-0.5",
        suspended ? "border-destructive/30 hover:border-destructive/60"
          : quarantine ? "border-amber-500/30 hover:border-amber-500/60"
          : "border-border hover:border-brand/40",
      )}
    >
      <div className="flex items-start justify-between">
        <span
          className={cn(
            "grid h-10 w-10 place-items-center rounded-xl border border-white/10",
            suspended ? "bg-destructive/15 text-destructive"
              : quarantine ? "bg-amber-500/15 text-amber-400"
              : all ? "gradient-brand text-white" : "bg-white/[0.06] text-brand",
          )}
        >
          {suspended ? <Ban className="h-5 w-5" strokeWidth={1.75} /> : quarantine ? <EyeOff className="h-5 w-5" strokeWidth={1.75} /> : all ? <Layers className="h-5 w-5" strokeWidth={1.75} /> : <Folder className="h-5 w-5" strokeWidth={1.75} />}
        </span>
        {onDelete && (
          <span
            role="button"
            tabIndex={0}
            title="Apagar pasta"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
          >
            <Trash2 className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="mt-3 text-sm font-medium text-foreground truncate">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {count} conta{count === 1 ? "" : "s"}
      </p>
      <FolderOpen className="absolute right-4 bottom-4 h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

function FolderPill({
  label, count, active, onClick, onDelete,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <span
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-full border pl-3 pr-2 py-1 text-xs transition-colors cursor-pointer",
        active
          ? "border-brand/50 bg-accent text-foreground"
          : "border-border text-muted-foreground hover:text-foreground hover:border-brand/30",
      )}
      onClick={onClick}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
      {onDelete && (
        <button
          type="button"
          title="Apagar pasta"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    active: { color: "bg-emerald-500", label: "Ativo" },
    dead: { color: "bg-destructive", label: "Inativo" },
    paused: { color: "bg-amber-500", label: "Pausado" },
    banned: { color: "bg-destructive", label: "Banido" },
    unknown: { color: "bg-muted-foreground/50", label: "Desconhecido" },
  };
  const s = map[status] ?? map.unknown;
  return (
    <Badge variant="outline" className="font-normal gap-1.5 text-[10px] uppercase tracking-wider">
      <span className={`h-1.5 w-1.5 rounded-full ${s.color}`} />
      {s.label}
    </Badge>
  );
}

function PoolStatus({ lastUsedAt, cooldownUntil }: { lastUsedAt?: string | null; cooldownUntil?: string | null }) {
  const now = Date.now();
  const cd = cooldownUntil ? Date.parse(cooldownUntil) : 0;
  const inCooldown = cd && cd > now;
  const lu = lastUsedAt ? Date.parse(lastUsedAt) : 0;
  const fmtAgo = (ms: number) => {
    const s = Math.floor((now - ms) / 1000);
    if (s < 60) return `${s}s atrás`;
    if (s < 3600) return `${Math.floor(s / 60)}min atrás`;
    if (s < 86400) return `${Math.floor(s / 3600)}h atrás`;
    return `${Math.floor(s / 86400)}d atrás`;
  };
  if (inCooldown) {
    const mins = Math.ceil((cd - now) / 60000);
    return <p className="text-xs text-amber-500">Em cooldown ({mins}min restantes)</p>;
  }
  return (
    <p className="text-xs text-foreground/70">
      {lu ? `Último uso: ${fmtAgo(lu)}` : "Nunca usada"}
    </p>
  );
}
