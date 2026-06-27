import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import {
  Users,
  Server,
  Workflow,
  ListChecks,
  Activity,
  Trophy,
  type LucideIcon,
} from "lucide-react";

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

function Stat({ label, value, hint, icon: Icon }: { label: string; value: number | string; hint?: string; icon: LucideIcon }) {
  return (
    <div className="group relative overflow-hidden border border-border bg-surface p-6 rounded-xl transition-all duration-300 hover:border-brand/30 hover:-translate-y-0.5">
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-brand/10 blur-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative flex items-start justify-between">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-brand">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </div>
      <p className="relative mt-4 text-3xl font-light text-foreground tabular-nums">{value}</p>
      {hint && <p className="relative mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Panel({ title, icon: Icon, children, className = "" }: { title: string; icon: LucideIcon; children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-border bg-surface rounded-xl overflow-hidden ${className}`}>
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-brand" strokeWidth={1.75} />
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{title}</p>
      </div>
      {children}
    </div>
  );
}

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard-stats"],
    refetchInterval: 15000,
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      const [accounts, proxies, flows, queue, logs, recentLogs] = await Promise.all([
        supabase.from("twitter_accounts").select("id, username, status"),
        supabase.from("proxies").select("id, status"),
        supabase.from("automation_flows").select("id, status"),
        supabase
          .from("execution_queue")
          .select("id, status, action_type, twitter_account_id, created_at")
          .gte("created_at", sevenDaysAgo)
          .limit(5000),
        supabase
          .from("execution_logs")
          .select("id, level, created_at")
          .gte("created_at", sevenDaysAgo)
          .limit(5000),
        supabase
          .from("execution_logs")
          .select("id, message, level, created_at")
          .order("created_at", { ascending: false })
          .limit(8),
      ]);
      return {
        accounts: accounts.data ?? [],
        proxies: proxies.data ?? [],
        flows: flows.data ?? [],
        queue: queue.data ?? [],
        logs: logs.data ?? [],
        recentLogs: recentLogs.data ?? [],
      };
    },
  });

  const accounts = data?.accounts ?? [];
  const queue = data?.queue ?? [];
  const logs = data?.logs ?? [];

  const activeAccounts = accounts.filter((a) => a.status === "active").length;
  const activeFlows = (data?.flows ?? []).filter((f) => f.status === "active").length;
  const activeProxies = (data?.proxies ?? []).filter((p) => p.status === "active").length;
  const pending = queue.filter((q) => q.status === "pending").length;

  // 7-day activity (completed tasks per day)
  const activity = useMemo(() => {
    const days: { label: string; value: number; key: string }[] = [];
    const fmt = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      days.push({ key, label: fmt.format(d).replace(".", ""), value: 0 });
    }
    const idx = new Map(days.map((d, i) => [d.key, i]));
    for (const q of queue) {
      if (q.status !== "completed") continue;
      const key = String(q.created_at).slice(0, 10);
      const i = idx.get(key);
      if (i !== undefined) days[i].value++;
    }
    return days;
  }, [queue]);

  const totalDone = activity.reduce((s, d) => s + d.value, 0);

  // Action distribution (completed)
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

  // Queue status breakdown
  const statusBreak = useMemo(() => {
    const s = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const q of queue) if (q.status in s) (s as any)[q.status]++;
    return s;
  }, [queue]);

  // Top accounts by completed actions
  const topAccounts = useMemo(() => {
    const byAcc = new Map<string, number>();
    for (const q of queue) {
      if (q.status !== "completed" || !q.twitter_account_id) continue;
      byAcc.set(q.twitter_account_id, (byAcc.get(q.twitter_account_id) ?? 0) + 1);
    }
    const nameById = new Map(accounts.map((a) => [a.id, a.username]));
    return Array.from(byAcc.entries())
      .map(([id, value]) => ({ id, value, username: nameById.get(id) ?? "—" }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [queue, accounts]);

  const maxTop = topAccounts[0]?.value ?? 1;

  return (
    <div className="px-10 py-10 max-w-7xl mx-auto">
      <PageHeader
        eyebrow="Visão geral"
        title="Painel operacional"
        description="Estado em tempo real das suas contas, proxies e automações."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
        <Stat icon={Users} label="Contas ativas" value={activeAccounts} hint={`${accounts.length} no total`} />
        <Stat icon={Server} label="Proxies ativos" value={activeProxies} hint={`${data?.proxies.length ?? 0} cadastrados`} />
        <Stat icon={Workflow} label="Fluxos rodando" value={activeFlows} hint={`${data?.flows.length ?? 0} cadastrados`} />
        <Stat icon={ListChecks} label="Tarefas pendentes" value={pending} hint={`${queue.length} na janela de 7 dias`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* Activity chart */}
        <Panel title="Atividade · últimos 7 dias" icon={Activity} className="lg:col-span-2">
          <div className="px-5 pt-4 pb-2">
            <p className="text-2xl font-light text-foreground tabular-nums">{totalDone}</p>
            <p className="text-xs text-muted-foreground">ações concluídas no período</p>
          </div>
          <div className="h-44 px-2 pb-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activity} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="barBrand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={BRAND} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={BRAND} stopOpacity={0.35} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ fill: "rgba(139,92,246,0.08)" }}
                  contentStyle={{
                    background: "rgba(25,22,38,0.95)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 12,
                    fontSize: 12,
                    color: "#fff",
                  }}
                  labelStyle={{ color: "rgba(255,255,255,0.6)" }}
                />
                <Bar dataKey="value" fill="url(#barBrand)" radius={[6, 6, 0, 0]} maxBarSize={42} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        {/* Distribution */}
        <Panel title="Distribuição de ações" icon={Workflow}>
          {distribution.length === 0 ? (
            <EmptyMini text="Sem ações concluídas ainda." />
          ) : (
            <div className="flex items-center gap-2 p-4">
              <div className="h-36 w-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={distribution} dataKey="value" nameKey="label" innerRadius={38} outerRadius={64} paddingAngle={3} stroke="none">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* Queue status */}
        <Panel title="Fila de execução" icon={ListChecks}>
          <div className="grid grid-cols-2 gap-3 p-5">
            <StatusPill label="Pendentes" value={statusBreak.pending} color={AMBER} />
            <StatusPill label="Processando" value={statusBreak.processing} color={CYAN} />
            <StatusPill label="Concluídas" value={statusBreak.completed} color={EMERALD} />
            <StatusPill label="Falhas" value={statusBreak.failed} color={RED} />
          </div>
        </Panel>

        {/* Top accounts */}
        <Panel title="Melhores contas" icon={Trophy} className="lg:col-span-2">
          {topAccounts.length === 0 ? (
            <EmptyMini text="Nenhuma atividade nas contas ainda." />
          ) : (
            <ul className="p-4 space-y-3">
              {topAccounts.map((a, i) => (
                <li key={a.id} className="flex items-center gap-3">
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-[11px] font-medium text-brand tabular-nums">
                    {i + 1}
                  </span>
                  <span className="text-sm text-foreground w-32 truncate">@{a.username}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                    <div className="h-full rounded-full gradient-brand" style={{ width: `${(a.value / maxTop) * 100}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{a.value}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Recent events */}
      <div className="mt-4 border border-border bg-surface rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Últimos eventos</p>
        </div>
        <div className="divide-y divide-border">
          {(data?.recentLogs ?? []).length === 0 && (
            <div className="px-6 py-12 text-sm text-muted-foreground text-center">
              Nenhum evento registrado ainda.
            </div>
          )}
          {data?.recentLogs.map((log) => (
            <div key={log.id} className="px-6 py-3 flex items-center justify-between gap-4 transition-colors hover:bg-accent/40">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: log.level === "error" ? RED : log.level === "warn" ? AMBER : EMERALD }}
                />
                <p className="text-sm text-foreground truncate">{log.message}</p>
              </div>
              <p className="text-xs text-muted-foreground shrink-0 tabular-nums">{new Date(log.created_at).toLocaleString("pt-BR")}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-1.5 text-2xl font-light text-foreground tabular-nums">{value}</p>
    </div>
  );
}

function EmptyMini({ text }: { text: string }) {
  return <div className="px-5 py-10 text-center text-xs text-muted-foreground">{text}</div>;
}
