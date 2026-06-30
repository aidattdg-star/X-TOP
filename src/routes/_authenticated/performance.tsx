import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getPerformanceLeaderboard, type AccountPerf, type UserPerf } from "@/lib/admin.functions";
import {
  Eye,
  Users,
  TrendingUp,
  Flame,
  Loader2,
  RefreshCw,
  Clock,
  Trophy,
  ArrowLeft,
  MessageSquare,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/performance")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profile?.role !== "admin") throw redirect({ to: "/dashboard" });
  },
  component: PerformancePage,
});

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return new Intl.NumberFormat("pt-BR").format(n);
}

function emailName(email: string | null, fallback: string): string {
  if (!email) return fallback;
  return email.split("@")[0];
}

function timeAgo(iso: string | null): string {
  if (!iso) return "nunca";
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < 0) return "agora";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.floor(h / 24)}d atrás`;
}

function PerformancePage() {
  const runLeaderboard = useServerFn(getPerformanceLeaderboard);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [tab, setTab] = useState<"users" | "accounts">("users");
  const [focusUser, setFocusUser] = useState<string | null>(null);

  const { data, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["performance-leaderboard"],
    queryFn: () => runLeaderboard(),
    refetchInterval: autoRefresh ? 15000 : false,
  });

  const perUser: UserPerf[] = data?.perUser ?? [];
  const perAccount: AccountPerf[] = data?.perAccount ?? [];
  const totals = data?.totals ?? { views: 0, tweets: 0, accounts: 0, users: 0, last_updated: null };

  const maxUserViews = useMemo(() => Math.max(1, ...perUser.map((u) => u.total_views)), [perUser]);
  const maxAccViews = useMemo(() => Math.max(1, ...perAccount.map((a) => a.views)), [perAccount]);

  const focusedUser = useMemo(
    () => (focusUser ? perUser.find((u) => u.user_id === focusUser) ?? null : null),
    [focusUser, perUser],
  );
  const focusedAccounts = useMemo(
    () => (focusUser ? perAccount.filter((a) => a.user_id === focusUser) : []),
    [focusUser, perAccount],
  );
  const maxFocusViews = useMemo(() => Math.max(1, ...focusedAccounts.map((a) => a.views)), [focusedAccounts]);

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <PageHeader
          eyebrow="Performance"
          title="Views em tempo real"
          description="Quais usuários e contas do SaaS estão performando mais em views. Atualiza sozinho — os dados são coletados em segundo plano a cada ~5 min."
        />
        <div className="flex items-center gap-2 mt-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
            className={autoRefresh ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : ""}
          >
            {autoRefresh ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Clock className="h-3.5 w-3.5 mr-2" />}
            Ao vivo {autoRefresh ? "ON" : "OFF"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn("h-3.5 w-3.5 mr-2", isFetching && "animate-spin")} /> Atualizar
          </Button>
        </div>
      </div>

      {/* Resumo geral */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
        <SummaryCard label="Views totais (SaaS)" value={fmt(totals.views)} icon={Eye} tone="brand" />
        <SummaryCard label="Tweets medidos" value={fmt(totals.tweets)} icon={MessageSquare} tone="muted" />
        <SummaryCard label="Contas" value={fmt(totals.accounts)} icon={Flame} tone="muted" />
        <SummaryCard label="Usuários" value={fmt(totals.users)} icon={Users} tone="muted" />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground flex items-center gap-1.5">
        <Clock className="h-3 w-3" /> última coleta {timeAgo(totals.last_updated)}
        {dataUpdatedAt ? ` · tela atualizada ${timeAgo(new Date(dataUpdatedAt).toISOString())}` : ""}
      </p>

      {/* Drill-down de um usuário */}
      {focusedUser ? (
        <div className="mt-8">
          <button
            onClick={() => setFocusUser(null)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5 mb-3"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> voltar ao ranking
          </button>
          <div className="liquid-glass rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-sky-400" />
              <h2 className="text-base font-medium text-foreground">{emailName(focusedUser.email, "usuário")}</h2>
              <span className="text-xs text-muted-foreground">{focusedUser.email}</span>
            </div>
            <p className="text-[12px] text-muted-foreground mb-4">
              {fmt(focusedUser.total_views)} views · {focusedUser.account_count} contas ({focusedUser.active_count} ativas) ·{" "}
              {fmt(focusedUser.total_followers)} seguidores
            </p>
            <div className="space-y-1.5">
              {focusedAccounts.map((a, i) => (
                <AccountRow key={a.account_id} acc={a} rank={i + 1} max={maxFocusViews} showOwner={false} />
              ))}
              {focusedAccounts.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">Sem contas com dados ainda.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="mt-8 flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/10 w-fit">
            <TabBtn active={tab === "users"} onClick={() => setTab("users")} icon={Users}>
              Por usuário
            </TabBtn>
            <TabBtn active={tab === "accounts"} onClick={() => setTab("accounts")} icon={Flame}>
              Por conta
            </TabBtn>
          </div>

          {tab === "users" ? (
            <div className="mt-5 space-y-2">
              {perUser.length === 0 && <EmptyState />}
              {perUser.map((u, i) => (
                <button
                  key={u.user_id}
                  onClick={() => setFocusUser(u.user_id)}
                  className="w-full text-left liquid-glass rounded-xl p-4 hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <RankBadge rank={i + 1} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate flex items-center gap-2">
                        {emailName(u.email, "usuário")}
                        <span className="text-[11px] text-muted-foreground font-normal">
                          {u.account_count} contas · {u.active_count} ativas
                        </span>
                      </p>
                      <div className="mt-2 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400"
                          style={{ width: `${Math.max(2, (u.total_views / maxUserViews) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-foreground tabular-nums flex items-center gap-1 justify-end">
                        <Eye className="h-3.5 w-3.5 text-sky-400" /> {fmt(u.total_views)}
                      </p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">{fmt(u.total_followers)} seg.</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-5 space-y-1.5">
              {perAccount.length === 0 && <EmptyState />}
              {perAccount.slice(0, 100).map((a, i) => (
                <AccountRow key={a.account_id} acc={a} rank={i + 1} max={maxAccViews} showOwner />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AccountRow({
  acc,
  rank,
  max,
  showOwner,
}: {
  acc: AccountPerf;
  rank: number;
  max: number;
  showOwner: boolean;
}) {
  const suspended = acc.status === "banned" || acc.status === "suspended";
  return (
    <div className="liquid-glass rounded-xl px-4 py-3 flex items-center gap-3">
      <RankBadge rank={rank} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground truncate flex items-center gap-2">
          <a
            href={`https://x.com/${acc.username}`}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            @{acc.username}
          </a>
          {showOwner && acc.owner_email && (
            <span className="text-[10px] text-muted-foreground">· {emailName(acc.owner_email, "")}</span>
          )}
          {suspended && (
            <span className="text-[10px] text-red-400 border border-red-500/30 rounded px-1">{acc.status}</span>
          )}
        </p>
        <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.06] overflow-hidden max-w-[420px]">
          <div
            className={cn("h-full rounded-full", suspended ? "bg-red-400/60" : "bg-gradient-to-r from-sky-500 to-emerald-400")}
            style={{ width: `${Math.max(2, (acc.views / max) * 100)}%` }}
          />
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-medium text-foreground tabular-nums flex items-center gap-1 justify-end">
          <Eye className="h-3.5 w-3.5 text-sky-400" /> {fmt(acc.views)}
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {acc.tweets} tweets · {fmt(acc.follower_count)} seg.
        </p>
      </div>
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const medal = rank === 1 ? "text-amber-300" : rank === 2 ? "text-zinc-300" : rank === 3 ? "text-orange-400" : "";
  return (
    <span
      className={cn(
        "grid place-items-center h-7 w-7 shrink-0 rounded-lg text-xs font-semibold tabular-nums",
        rank <= 3 ? "bg-white/[0.08] border border-white/10" : "text-muted-foreground",
      )}
    >
      {rank <= 3 ? <Trophy className={cn("h-3.5 w-3.5", medal)} /> : rank}
    </span>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors",
        active ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {children}
    </button>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: any;
  tone: "brand" | "muted";
}) {
  return (
    <div className="liquid-glass rounded-xl p-4">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-3.5 w-3.5", tone === "brand" ? "text-sky-400" : "text-muted-foreground")} strokeWidth={1.5} />
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-light text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="liquid-glass rounded-2xl p-10 text-center">
      <TrendingUp className="h-6 w-6 text-sky-400 mx-auto mb-3" />
      <p className="text-sm text-foreground">Sem dados de views ainda</p>
      <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
        A coleta roda em segundo plano a cada ~5 min. Confirme que o cron <b>collect-views</b> está ativo
        (VIEW_STATS.sql) e volte aqui em alguns minutos.
      </p>
    </div>
  );
}
