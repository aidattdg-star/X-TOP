import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import {
  Users,
  Server,
  Workflow,
  ListChecks,
  Activity,
  Trophy,
  Heart,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

const BRAND = "#8b5cf6";
const CYAN = "#22d3ee";
const PINK = "#f472b6";
const EMERALD = "#34d399";
const AMBER = "#fbbf24";
const RED = "#f87171";

const ACTION_META: Record<string, { label: string; color: string }> = {
  "action.post_tweet": { label: "Tweets", color: BRAND },
  "action.retweet": { label: "Retweets", color: CYAN },
  "action.comment": { label: "Comentários", color: PINK },
  "action.mass_engage": { label: "RT/Like massa", color: EMERALD },
};

const PERIODS = [
  { key: "7d", label: "7 dias", days: 7 },
  { key: "30d", label: "30 dias", days: 30 },
] as const;
type PeriodKey = (typeof PERIODS)[number]["key"];

function greeting(): string {
  const hExpr = new Date().getHours();
  if (hExpr < 12) return "Bom dia";
  if (hExpr < 18) return "Boa tarde";
  return "Boa noite";
}

function Dashboard() {
  const [period, setPeriod] = useState<PeriodKey>("7d");
  const [email, setEmail] = useState<string | null>(null);
  const days = PERIODS.find((p) => p.key === period)!.days;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  const { data } = useQuery({
    queryKey: ["dashboard-stats", days],
    refetchInterval: 15000,
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86400_000).toISOString();
      const [accounts, proxies, flows, queue, recentLogs] = await Promise.all([
        supabase.from("twitter_accounts").select("id, username, status, profile_picture_url"),
        supabase.from("proxies").select("id, status"),
        supabase.from("automation_flows").select("id, status"),
        supabase
          .from("execution_queue")
          .select("id, status, action_type, twitter_account_id, created_at")
          .gte("created_at", since)
          .limit(8000),
        supabase
          .from("execution_logs")
          .select("id, message, level, created_at")
          .order("created_at", { ascending: false })
          .limit(7),
      ]);
      return {
        accounts: accounts.data ?? [],
        proxies: proxies.data ?? [],
        flows: flows.data ?? [],
        queue: queue.data ?? [],
        recentLogs: recentLogs.data ?? [],
      };
    },
  });

  const accounts = data?.accounts ?? [];
  const queue = data?.queue ?? [];

  const activeAccounts = accounts.filter((a) => a.status === "active").length;
  const activeFlows = (data?.flows ?? []).filter((f) => f.status === "active").length;
  const activeProxies = (data?.proxies ?? []).filter((p) => p.status === "active").length;
  const pending = queue.filter((q) => q.status === "pending").length;

  // série diária de ações concluídas
  const activity = useMemo(() => {
    const out: { key: string; label: string; value: number }[] = [];
    const wfmt = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
    const dfmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      out.push({
        key: d.toISOString().slice(0, 10),
        label: days <= 7 ? wfmt.format(d).replace(".", "") : dfmt.format(d),
        value: 0,
      });
    }
    const idx = new Map(out.map((d, i) => [d.key, i]));
    for (const q of queue) {
      if (q.status !== "completed") continue;
      const i = idx.get(String(q.created_at).slice(0, 10));
      if (i !== undefined) out[i].value++;
    }
    return out;
  }, [queue, days]);

  const totalDone = activity.reduce((s, d) => s + d.value, 0);

  const statusBreak = useMemo(() => {
    const s = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const q of queue) if (q.status in s) (s as Record<string, number>)[q.status]++;
    return s;
  }, [queue]);

  const successRate =
    statusBreak.completed + statusBreak.failed > 0
      ? Math.round((statusBreak.completed / (statusBreak.completed + statusBreak.failed)) * 100)
      : 0;

  const distribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of queue) {
      if (q.status !== "completed") continue;
      counts.set(q.action_type, (counts.get(q.action_type) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([type, value]) => ({
        type,
        value,
        label: ACTION_META[type]?.label ?? type,
        color: ACTION_META[type]?.color ?? BRAND,
      }))
      .sort((a, b) => b.value - a.value);
  }, [queue]);

  const topAccounts = useMemo(() => {
    const byAcc = new Map<string, number>();
    for (const q of queue) {
      if (q.status !== "completed" || !q.twitter_account_id) continue;
      byAcc.set(q.twitter_account_id, (byAcc.get(q.twitter_account_id) ?? 0) + 1);
    }
    const byId = new Map(accounts.map((a) => [a.id, a]));
    return Array.from(byAcc.entries())
      .map(([id, value]) => ({ id, value, acc: byId.get(id) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [queue, accounts]);

  const maxTop = topAccounts[0]?.value ?? 1;
  const name = email ? email.split("@")[0] : "";

  return (
    <div className="relative px-8 lg:px-10 py-9 max-w-7xl mx-auto">
      {/* profundidade ambiente */}
      <div className="pointer-events-none absolute -top-24 -left-16 h-80 w-80 rounded-full bg-brand/15 blur-[120px]" />
      <div className="pointer-events-none absolute top-40 -right-10 h-72 w-72 rounded-full bg-brand-2/12 blur-[120px]" />

      <div className="relative">
        {/* Header com saudação + período */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full gradient-brand shadow-[0_0_8px_2px_oklch(0.66_0.2_285_/_0.6)]" />
              Visão geral
            </p>
            <h1 className="mt-2.5 text-3xl font-light tracking-tight text-foreground">
              {greeting()}, <span className="text-gradient font-medium">{name || "operador"}</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
            </p>
          </div>

          {/* tabs de período */}
          <div className="inline-flex gap-1 p-1 rounded-xl liquid-glass">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "relative px-4 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  period === p.key
                    ? "bg-white/[0.08] text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
          <MetricCard
            icon={Users}
            title="Contas ativas"
            value={activeAccounts}
            hint={`${accounts.length} no total`}
            progress={accounts.length ? activeAccounts / accounts.length : 0}
            color={BRAND}
          />
          <MetricCard
            icon={Server}
            title="Proxies ativos"
            value={activeProxies}
            hint={`${data?.proxies.length ?? 0} cadastrados`}
            progress={data?.proxies.length ? activeProxies / data.proxies.length : 0}
            color={CYAN}
          />
          <MetricCard
            icon={Workflow}
            title="Fluxos rodando"
            value={activeFlows}
            hint={`${data?.flows.length ?? 0} cadastrados`}
            progress={data?.flows.length ? activeFlows / data.flows.length : 0}
            color={PINK}
          />
          <MetricCard
            icon={ListChecks}
            title="Tarefas pendentes"
            value={pending}
            hint={`${queue.length} na janela`}
            progress={queue.length ? pending / queue.length : 0}
            color={AMBER}
          />
        </div>

        {/* Desempenho (área) + medidor */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
          <Panel title="Desempenho" icon={Activity} className="lg:col-span-2">
            <div className="px-6 pt-5 pb-1 flex items-end justify-between">
              <div>
                <p className="text-3xl font-light text-foreground tabular-nums leading-none">{totalDone}</p>
                <p className="mt-1.5 text-xs text-muted-foreground">ações concluídas no período</p>
              </div>
              <p className="text-xs text-muted-foreground">últimos {days} dias</p>
            </div>
            <div className="h-52 px-2 pb-3 pt-3">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activity} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="areaBrand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={BRAND} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="lineBrand" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={BRAND} />
                      <stop offset="100%" stopColor={CYAN} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={24}
                    tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ stroke: "rgba(139,92,246,0.4)", strokeWidth: 1 }}
                    contentStyle={{
                      background: "rgba(25,22,38,0.95)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 12,
                      fontSize: 12,
                      color: "#fff",
                      backdropFilter: "blur(8px)",
                    }}
                    labelStyle={{ color: "rgba(255,255,255,0.6)" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="url(#lineBrand)"
                    strokeWidth={2.5}
                    fill="url(#areaBrand)"
                    dot={false}
                    activeDot={{ r: 4, fill: BRAND, stroke: "#fff", strokeWidth: 1.5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {/* Medidor de taxa de sucesso */}
          <Panel title="Taxa de conclusão" icon={Heart}>
            <div className="relative grid place-items-center py-6">
              <div className="relative h-44 w-44">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart
                    innerRadius="74%"
                    outerRadius="100%"
                    data={[{ value: successRate }]}
                    startAngle={220}
                    endAngle={-40}
                  >
                    <defs>
                      <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={BRAND} />
                        <stop offset="100%" stopColor={CYAN} />
                      </linearGradient>
                    </defs>
                    <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                    <RadialBar
                      background={{ fill: "rgba(255,255,255,0.06)" }}
                      dataKey="value"
                      cornerRadius={20}
                      fill="url(#gaugeGrad)"
                    />
                  </RadialBarChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 grid place-items-center">
                  <div className="text-center">
                    <p className="text-3xl font-light text-foreground tabular-nums leading-none">{successRate}%</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">sucesso</p>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: EMERALD }} />
                  {statusBreak.completed} ok
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: RED }} />
                  {statusBreak.failed} falhas
                </span>
              </div>
            </div>
          </Panel>
        </div>

        {/* Feed + distribuição + ranking */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
          {/* Log de atividades */}
          <Panel title="Log de atividades" icon={Activity}>
            <div className="divide-y divide-white/[0.05] max-h-72 overflow-auto">
              {(data?.recentLogs ?? []).length === 0 && (
                <div className="px-6 py-12 text-center text-xs text-muted-foreground">
                  Nenhum evento registrado ainda.
                </div>
              )}
              {data?.recentLogs.map((log) => (
                <div key={log.id} className="px-5 py-3 flex items-start gap-3 transition-colors hover:bg-white/[0.03]">
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      background: log.level === "error" ? RED : log.level === "warn" ? AMBER : EMERALD,
                      boxShadow: `0 0 8px ${log.level === "error" ? RED : log.level === "warn" ? AMBER : EMERALD}`,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-foreground leading-snug line-clamp-2">{log.message}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                      {new Date(log.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          {/* Distribuição */}
          <Panel title="Distribuição de ações" icon={Workflow}>
            {distribution.length === 0 ? (
              <EmptyMini text="Sem ações concluídas ainda." />
            ) : (
              <div className="flex items-center gap-2 p-4">
                <div className="h-36 w-36 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={distribution} dataKey="value" nameKey="label" innerRadius={40} outerRadius={64} paddingAngle={3} stroke="none">
                        {distribution.map((d) => (
                          <Cell key={d.type} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "rgba(25,22,38,0.95)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 12,
                          fontSize: 12,
                          color: "#fff",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="flex-1 space-y-2">
                  {distribution.map((d) => (
                    <li key={d.type} className="flex items-center gap-2 text-xs">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
                      <span className="text-muted-foreground flex-1 truncate">{d.label}</span>
                      <span className="text-foreground tabular-nums">{d.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {/* Ranking de contas */}
          <Panel title="Melhores contas" icon={Trophy}>
            {topAccounts.length === 0 ? (
              <EmptyMini text="Nenhuma atividade nas contas ainda." />
            ) : (
              <ul className="p-3 space-y-1">
                {topAccounts.map((a, i) => (
                  <li key={a.id} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.03]">
                    <span
                      className={cn(
                        "grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[11px] font-semibold tabular-nums",
                        i === 0 ? "gradient-brand text-white" : "bg-white/[0.06] text-brand",
                      )}
                    >
                      {i + 1}
                    </span>
                    <div className="h-7 w-7 shrink-0 rounded-full overflow-hidden bg-white/[0.06] grid place-items-center text-[10px] text-muted-foreground uppercase">
                      {a.acc?.profile_picture_url ? (
                        <img src={a.acc.profile_picture_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        (a.acc?.username ?? "—").slice(0, 2)
                      )}
                    </div>
                    <span className="text-[13px] text-foreground truncate flex-1">@{a.acc?.username ?? "—"}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{a.value}</span>
                    <div className="hidden sm:block w-14 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                      <div className="h-full rounded-full gradient-brand" style={{ width: `${(a.value / maxTop) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  title,
  value,
  hint,
  progress,
  color,
}: {
  icon: LucideIcon;
  title: string;
  value: number | string;
  hint?: string;
  progress: number;
  color: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  return (
    <div className="liquid-glass is-interactive group relative overflow-hidden p-5 rounded-2xl">
      <span className="sheen" />
      <div className="relative flex items-center gap-2.5">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10"
          style={{ background: `${color}1f`, color }}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{title}</p>
      </div>
      <p className="relative mt-4 text-[2rem] leading-none font-light text-foreground tabular-nums">{value}</p>
      <div className="relative mt-3 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${color}, ${color}aa)` }} />
      </div>
      {hint && <p className="relative mt-2 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Panel({ title, icon: Icon, children, className = "" }: { title: string; icon: LucideIcon; children: React.ReactNode; className?: string }) {
  return (
    <div className={`liquid-glass rounded-2xl overflow-hidden ${className}`}>
      <div className="relative px-5 py-4 border-b border-white/[0.06] flex items-center gap-2.5">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-white/[0.06] border border-white/10">
          <Icon className="h-3.5 w-3.5 text-brand" strokeWidth={1.75} />
        </span>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

function EmptyMini({ text }: { text: string }) {
  return <div className="px-5 py-12 text-center text-xs text-muted-foreground">{text}</div>;
}
