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
import { Server, AtSign, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { testTwitterAccount } from "@/lib/accounts.functions";
import { testProxyConnection } from "@/lib/proxies.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/accounts")({
  component: AccountsPage,
});

function AccountsPage() {
  const qc = useQueryClient();
  const [proxyOpen, setProxyOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<{ id: string; username: string; display_name: string | null } | null>(null);
  const [testingAcc, setTestingAcc] = useState<string | null>(null);
  const runTestAccount = useServerFn(testTwitterAccount);
  const runTestProxy = useServerFn(testProxyConnection);

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

  async function testProxy(id: string) {
    setTesting(id);
    try {
      const res = await runTestProxy({ data: { proxy_id: id } });
      if (res.status === "active") {
        toast.success(`Proxy OK · ${res.latency_ms}ms${res.exit_ip ? ` · IP ${res.exit_ip}` : ""}`);
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
  const [proxyTab, setProxyTab] = useState<"live" | "bad" | "die">("live");

  async function deleteManyProxies(ids: string[], kind: string) {
    if (!ids.length) return;
    if (!confirm(`Remover as ${ids.length} proxy(s) ${kind}? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from("proxies").delete().in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`${ids.length} proxy(s) removida(s)`);
    qc.invalidateQueries({ queryKey: ["proxies"] });
    qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
  }
  async function testAllProxies() {
    if (!proxies?.length) return;
    setTestingAll(true);
    setTestAllDone(0);
    try {
      for (let i = 0; i < proxies.length; i++) {
        try { await runTestProxy({ data: { proxy_id: proxies[i].id } }); } catch { /* segue */ }
        setTestAllDone(i + 1);
      }
      qc.invalidateQueries({ queryKey: ["proxies"] });
      toast.success("Todos os proxies testados");
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
    <div className="px-10 py-10 max-w-7xl mx-auto">
      <PageHeader
        eyebrow="Operação"
        title="Contas & Proxies"
        description="Isolamento máximo: cada conta do X opera através de um proxy dedicado."
        actions={
          <>
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

        {(!accounts || accounts.length === 0) && (
          <div className="border border-dashed border-border rounded-lg p-12 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhuma conta cadastrada. {proxies?.length ? "Adicione uma nova conta." : "Cadastre primeiro um proxy."}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts?.map((acc) => (
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
                  onClick={() => setEditingAccount({ id: acc.id, username: acc.username, display_name: acc.display_name })}
                  className="text-xs text-foreground hover:underline"
                >
                  Editar perfil
                </button>
                <button
                  onClick={() => deleteAccount(acc.id)}
                  className="text-xs text-muted-foreground hover:text-destructive ml-auto"
                >
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        {(() => {
          const all = proxies ?? [];
          const die = all.filter(isDieProxy);
          const bad = all.filter((p) => !isDieProxy(p) && isBadProxy(p));
          const live = all.filter((p) => !isDieProxy(p) && !isBadProxy(p));
          const shown = proxyTab === "die" ? die : proxyTab === "bad" ? bad : live;
          const removable = proxyTab === "die" ? die : proxyTab === "bad" ? bad : [];
          const emptyMsg =
            proxyTab === "die" ? "Nenhum proxy morto. 🎉"
            : proxyTab === "bad" ? "Nenhum proxy ruim. 🎉"
            : "Nenhum proxy live ainda — rode \"Testar todos\".";
          return (
        <>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Proxies</h2>
            <div className="flex gap-1 p-1 rounded-lg bg-muted/40 border border-border">
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
          </div>
          <div className="flex items-center gap-2">
            {removable.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => deleteManyProxies(removable.map((p) => p.id), proxyTab)} className="border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground">
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Remover todas {proxyTab} ({removable.length})
              </Button>
            )}
            {!!all.length && (
              <Button variant="outline" size="sm" onClick={testAllProxies} disabled={testingAll}>
                {testingAll ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Testando {testAllDone}/{all.length}</>
                ) : (
                  <>Testar todos</>
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
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground bg-muted/40">
                <tr>
                  <th className="text-left px-5 py-3 font-normal">Endereço</th>
                  <th className="text-left px-5 py-3 font-normal">Usuário</th>
                  <th className="text-left px-5 py-3 font-normal">Qualidade</th>
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
function isDieProxy(p: any): boolean {
  return p?.status === "dead" || p?.quality === "dead";
}
function isBadProxy(p: any): boolean {
  return p?.quality === "datacenter" || p?.quality === "slow" || (p?.fail_count ?? 0) >= 5;
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
  const map: Record<string, { label: string; cls: string }> = {
    good: { label: "Bom", cls: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10" },
    slow: { label: "Lento", cls: "border-amber-500/40 text-amber-400 bg-amber-500/10" },
    datacenter: { label: "Datacenter — troque", cls: "border-red-500/40 text-red-400 bg-red-500/10" },
    dead: { label: "Morto — troque", cls: "border-red-500/40 text-red-400 bg-red-500/10" },
  };
  const q = map[quality] ?? { label: quality, cls: "border-border text-muted-foreground" };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] uppercase tracking-wider ${q.cls}`}>
        {q.label}
      </span>
      {typeof latency === "number" && quality !== "dead" && (
        <span className="text-[10px] text-muted-foreground tabular-nums">{latency}ms</span>
      )}
      {(fails ?? 0) >= 5 && <span className="text-[10px] text-red-400">{fails} falhas</span>}
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
