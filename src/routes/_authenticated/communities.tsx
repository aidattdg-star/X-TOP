import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { syncCommunities, postToCommunity } from "@/lib/account-profile.functions";
import {
  Users2,
  RefreshCw,
  Loader2,
  Send,
  Search,
  CheckCircle2,
  Lock,
  ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/communities")({
  component: CommunitiesPage,
});

type Community = {
  id: string;
  account_id: string;
  community_id: string;
  name: string | null;
  description: string | null;
  member_count: number | null;
  role: string | null;
  can_post: boolean;
  twitter_accounts: { username: string } | null;
};

function fmtMembers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function CommunitiesPage() {
  const qc = useQueryClient();
  const runSync = useServerFn(syncCommunities);
  const runPost = useServerFn(postToCommunity);

  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState("");
  const [target, setTarget] = useState<{ accountId: string; communityId: string; name: string; username: string } | null>(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  const { data: communities = [] } = useQuery<Community[]>({
    queryKey: ["communities"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("twitter_communities")
        .select("id, account_id, community_id, name, description, member_count, role, can_post, twitter_accounts(username)")
        .order("can_post", { ascending: false })
        .order("member_count", { ascending: false });
      return (data ?? []) as Community[];
    },
  });

  const postable = useMemo(() => communities.filter((c) => c.can_post), [communities]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return communities;
    return communities.filter(
      (c) =>
        (c.name ?? "").toLowerCase().includes(q) ||
        (c.twitter_accounts?.username ?? "").toLowerCase().includes(q),
    );
  }, [communities, filter]);

  async function handleSync() {
    setSyncing(true);
    try {
      const r = await runSync({ data: {} });
      if (r.scanned === 0) {
        toast.message("Nenhuma conta ativa para escanear comunidades.");
      } else if (r.found === 0) {
        toast.message(`Escaneei ${r.scanned} conta(s), mas nenhuma comunidade foi encontrada.${r.errors ? ` (${r.errors} erro(s))` : ""}`);
      } else {
        toast.success(`${r.found} comunidade(s) encontradas · ${r.postable} onde dá pra postar (${r.scanned} conta(s))`);
      }
      if (r.errSamples?.length) toast.message(r.errSamples.join(" · "));
      qc.invalidateQueries({ queryKey: ["communities"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar comunidades");
    } finally {
      setSyncing(false);
    }
  }

  async function handlePost() {
    if (!target) return;
    const body = text.trim();
    if (!body) {
      toast.error("Escreva o texto do post.");
      return;
    }
    setPosting(true);
    try {
      const r = await runPost({
        data: { accountId: target.accountId, communityId: target.communityId, text: body },
      });
      toast.success(
        <span>
          Postado em <b>{target.name}</b> por @{target.username}.{" "}
          {r.url && (
            <a href={r.url} target="_blank" rel="noreferrer" className="underline">
              ver
            </a>
          )}
        </span>,
      );
      setText("");
      setTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao postar");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="X Communities"
        title="Comunidades"
        description="Veja as comunidades que suas contas participam e poste dentro delas. Só dá pra postar em comunidades onde a conta é membro."
        actions={
          <Button onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar comunidades
          </Button>
        }
      />

      {/* Composer (aparece ao escolher uma comunidade) */}
      {target && (
        <div className="mt-8 liquid-glass rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users2 className="h-4 w-4 text-sky-400" />
            <p className="text-sm text-foreground">
              Postar em <b>{target.name}</b> <span className="text-muted-foreground">por @{target.username}</span>
            </p>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={280}
            rows={3}
            autoFocus
            placeholder="O que você quer postar nessa comunidade?"
            className="w-full resize-none rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-sky-400/40"
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground tabular-nums">{text.length}/280</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => { setTarget(null); setText(""); }} disabled={posting}>
                Cancelar
              </Button>
              <Button onClick={handlePost} disabled={posting || !text.trim()}>
                {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Postar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Busca + resumo */}
      <div className="mt-8 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Buscar comunidade ou @conta…"
            className="w-full rounded-xl bg-white/[0.04] border border-white/10 pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-white/20"
          />
        </div>
        <span className="text-[12px] text-muted-foreground whitespace-nowrap">
          {postable.length} p/ postar · {communities.length} no total
        </span>
      </div>

      {/* Lista */}
      {communities.length === 0 ? (
        <div className="mt-6 liquid-glass rounded-2xl p-10 text-center">
          <Users2 className="h-6 w-6 text-sky-400 mx-auto mb-3" />
          <p className="text-sm text-foreground">Nenhuma comunidade ainda</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Clique em <b>Sincronizar comunidades</b> — vamos puxar as comunidades que suas contas enxergam no X.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {visible.map((c) => (
            <div key={c.id} className="liquid-glass rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground truncate flex items-center gap-2">
                  <Users2 className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                  {c.name || `Comunidade ${c.community_id}`}
                  {c.can_post ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300/90">
                      <CheckCircle2 className="h-3 w-3" /> {c.role || "membro"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Lock className="h-3 w-3" /> não é membro
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  @{c.twitter_accounts?.username ?? "—"} · {fmtMembers(Number(c.member_count ?? 0))} membros
                  {c.description ? ` · ${c.description}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`https://x.com/i/communities/${c.community_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                  title="Abrir no X"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <Button
                  size="sm"
                  disabled={!c.can_post}
                  onClick={() =>
                    setTarget({
                      accountId: c.account_id,
                      communityId: c.community_id,
                      name: c.name || `Comunidade ${c.community_id}`,
                      username: c.twitter_accounts?.username ?? "",
                    })
                  }
                  className={cn(!c.can_post && "opacity-40")}
                >
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Postar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
