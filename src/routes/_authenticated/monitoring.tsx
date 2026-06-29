import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
  Trash2,
  Pause,
  Play,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CreateMonitorModal } from "@/components/monitoring/create-monitor-modal";

export const Route = createFileRoute("/_authenticated/monitoring")({
  component: MonitoringPage,
});

type FlowRow = {
  id: string;
  name: string;
  status: string;
  account_ids: string[];
  react_flow_data: any;
};

type AccountRow = {
  id: string;
  username: string;
  auth_tokens: any;
  status: string;
};

type MonitorStateRow = {
  flow_id: string;
  last_tweet_id: string | null;
  last_checked_at: string;
  processed_tweet_ids: string[];
};

type LogRow = {
  id: string;
  created_at: string;
  level: string;
  message: string;
  flow_id: string | null;
  twitter_account_id: string | null;
};

function MonitoringPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);

  const flowsQuery = useQuery({
    queryKey: ["monitoring_flows"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("automation_flows")
        .select("id, name, status, account_ids, react_flow_data")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FlowRow[];
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const accountsQuery = useQuery({
    queryKey: ["monitoring_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("twitter_accounts")
        .select("id, username, auth_tokens, status");
      if (error) throw error;
      return (data ?? []) as AccountRow[];
    },
    refetchInterval: autoRefresh ? 10000 : false,
  });

  const stateQuery = useQuery({
    queryKey: ["monitoring_state"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("flow_monitor_state")
        .select("flow_id, last_tweet_id, last_checked_at, processed_tweet_ids");
      if (error) throw error;
      return (data ?? []) as MonitorStateRow[];
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const logsQuery = useQuery({
    queryKey: ["monitoring_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("execution_logs")
        .select("id, created_at, level, message, flow_id, twitter_account_id")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as LogRow[];
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const accountsById = useMemo(() => {
    const m = new Map<string, AccountRow>();
    for (const a of accountsQuery.data ?? []) m.set(a.id, a);
    return m;
  }, [accountsQuery.data]);

  const stateByFlow = useMemo(() => {
    const m = new Map<string, MonitorStateRow>();
    for (const s of stateQuery.data ?? []) m.set(s.flow_id, s);
    return m;
  }, [stateQuery.data]);

  const logsByFlow = useMemo(() => {
    const m = new Map<string, LogRow[]>();
    for (const l of logsQuery.data ?? []) {
      if (!l.flow_id) continue;
      const arr = m.get(l.flow_id) ?? [];
      arr.push(l);
      m.set(l.flow_id, arr);
    }
    return m;
  }, [logsQuery.data]);

  const monitors = useMemo(() => {
    const rows: Array<{
      flow: FlowRow;
      handle: string;
      intervalMin: number;
      selectMode: string;
      linkedAccounts: AccountRow[];
      missingAccountIds: string[];
      reader: AccountRow | null;
      state: MonitorStateRow | null;
      logs: LogRow[];
      health: "ok" | "warn" | "error" | "idle";
      healthMsg: string;
    }> = [];

    for (const flow of flowsQuery.data ?? []) {
      const nodes = (flow.react_flow_data?.nodes ?? []) as any[];
      const monitor = nodes.find((n) => n.data?.kind === "trigger.monitor_account");
      if (!monitor) continue;

      const handle = String(monitor.data?.config?.account ?? "").replace(/^@/, "").trim();
      const intervalMin = Math.max(1, Number(monitor.data?.config?.interval_minutes) || 10);
      const selectMode = (monitor.data?.config?.select_mode as string) || "last";

      const ids: string[] = flow.account_ids ?? [];
      const linked: AccountRow[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const a = accountsById.get(id);
        if (a) linked.push(a);
        else missing.push(id);
      }
      const reader = linked.find((a) => a.auth_tokens?.ct0 && a.auth_tokens?.auth_token) ?? null;
      const state = stateByFlow.get(flow.id) ?? null;
      const logs = logsByFlow.get(flow.id) ?? [];

      let health: "ok" | "warn" | "error" | "idle" = "idle";
      let healthMsg = "";
      const recent = logs.slice(0, 10);
      const recentErr = recent.find((l) => l.level === "error");
      const recentWarn = recent.find((l) => l.level === "warn");

      if (flow.status !== "active") {
        health = "idle";
        healthMsg = "Fluxo não está ativo";
      } else if (missing.length === ids.length || !linked.length) {
        health = "error";
        healthMsg = "Nenhuma conta válida vinculada ao fluxo";
      } else if (!reader) {
        health = "error";
        healthMsg = "Nenhuma conta com cookies válidos (ct0 + auth_token)";
      } else if (recentErr) {
        health = "error";
        healthMsg = recentErr.message;
      } else if (recentWarn) {
        health = "warn";
        healthMsg = recentWarn.message;
      } else if (state) {
        health = "ok";
        healthMsg = "Monitorando normalmente";
      } else {
        health = "warn";
        healthMsg = "Aguardando primeira verificação";
      }

      rows.push({
        flow,
        handle,
        intervalMin,
        selectMode,
        linkedAccounts: linked,
        missingAccountIds: missing,
        reader,
        state,
        logs,
        health,
        healthMsg,
      });
    }
    return rows;
  }, [flowsQuery.data, accountsById, stateByFlow, logsByFlow]);

  function refreshAll() {
    flowsQuery.refetch();
    accountsQuery.refetch();
    stateQuery.refetch();
    logsQuery.refetch();
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const stats = useMemo(() => {
    const s = { total: monitors.length, ok: 0, warn: 0, error: 0, idle: 0 };
    for (const m of monitors) s[m.health]++;
    return s;
  }, [monitors]);

  // Ações que deram certo (tweet/RT/like/comentário publicado) — pra ver os sucessos.
  const successLogs = useMemo(() => {
    return (logsQuery.data ?? [])
      .filter((l) => l.level === "info" && /^(💬|🔁|❤️)|publicado/.test(l.message))
      .slice(0, 30);
  }, [logsQuery.data]);

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-7xl mx-auto">
      <div className="flex items-start justify-between">
        <PageHeader
          eyebrow="Observabilidade"
          title="Monitoramento"
          description="Contas sendo monitoradas em tempo real, status de leitura e por que cada monitor está (ou não) disparando ações."
        />
        <div className="flex items-center gap-2 mt-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-2" /> Criar monitor
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
            className={autoRefresh ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : ""}
          >
            {autoRefresh ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <Clock className="h-3.5 w-3.5 mr-2" />}
            Auto-refresh {autoRefresh ? "ON (5s)" : "OFF"}
          </Button>
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className="h-3.5 w-3.5 mr-2" /> Atualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
        <StatCard label="Monitores" value={stats.total} icon={Eye} tone="muted" />
        <StatCard label="Saudáveis" value={stats.ok} icon={CheckCircle2} tone="success" />
        <StatCard label="Avisos" value={stats.warn} icon={AlertTriangle} tone="warn" />
        <StatCard label="Erros" value={stats.error} icon={XCircle} tone="danger" />
      </div>

      {successLogs.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Ações com sucesso
            </h2>
            <span className="text-xs text-muted-foreground">{successLogs.length} recentes</span>
          </div>
          <div className="border border-emerald-500/15 bg-emerald-500/[0.03] rounded-lg divide-y divide-border max-h-72 overflow-auto">
            {successLogs.map((l) => (
              <div key={l.id} className="px-4 py-2 flex items-start gap-3 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                <span className="text-muted-foreground whitespace-nowrap font-mono">
                  {new Date(l.created_at).toLocaleTimeString("pt-BR")}
                </span>
                <span className="flex-1 text-foreground/90 break-words"><LinkifiedMsg text={l.message} /></span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 space-y-3">
        {monitors.length === 0 ? (
          <div className="border border-border bg-surface rounded-lg p-10 text-center">
            <Activity className="h-5 w-5 text-muted-foreground mx-auto mb-3" strokeWidth={1.5} />
            <p className="text-sm text-foreground">Nenhum monitor configurado</p>
            <p className="mt-2 text-xs text-muted-foreground max-w-md mx-auto">
              Crie um monitor: escolha os @ alvo e suas contas reagem automaticamente quando eles postarem.
            </p>
            <Button size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-2" /> Criar monitor
            </Button>
          </div>
        ) : (
          monitors.map((m) => (
            <MonitorCard
              key={m.flow.id}
              monitor={m}
              expanded={expanded.has(m.flow.id)}
              onToggle={() => toggle(m.flow.id)}
              onChanged={refreshAll}
            />
          ))
        )}
      </div>

      <CreateMonitorModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        accounts={(accountsQuery.data ?? []).map((a) => ({ id: a.id, username: a.username }))}
      />
    </div>
  );
}

function MonitorCard({
  monitor: m,
  expanded,
  onToggle,
  onChanged,
}: {
  monitor: MonitorViewModel;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const lastCheckedAgo = m.state?.last_checked_at ? timeAgo(m.state.last_checked_at) : "nunca";
  const isStale =
    m.state?.last_checked_at &&
    Date.now() - Date.parse(m.state.last_checked_at) > (m.intervalMin + 5) * 60_000;
  const active = m.flow.status === "active";

  async function cancelPendingTasks(): Promise<number> {
    const { data } = await supabase
      .from("execution_queue")
      .update({ status: "failed", last_error: "Cancelado manualmente no monitor", updated_at: new Date().toISOString() })
      .eq("flow_id", m.flow.id)
      .in("status", ["pending", "processing"])
      .select("id");
    return (data ?? []).length;
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await supabase.from("automation_flows").update({ status: active ? "draft" : "active" }).eq("id", m.flow.id);
      if (active) {
        const n = await cancelPendingTasks();
        toast.success(`Monitor pausado${n ? ` · ${n} tarefa(s) pendente(s) cancelada(s)` : ""}`);
      } else {
        toast.success("Monitor ativado");
      }
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setBusy(false);
    }
  }

  async function cancelTasks() {
    setBusy(true);
    try {
      const n = await cancelPendingTasks();
      toast.success(n ? `${n} tarefa(s) pendente(s) cancelada(s)` : "Nenhuma tarefa pendente");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMonitor() {
    if (!confirm(`Excluir o monitor @${m.handle || "(vazio)"}? Remove o monitor, cancela as tarefas pendentes e apaga o estado. Suas contas NÃO são apagadas.`)) return;
    setBusy(true);
    try {
      await cancelPendingTasks();
      await supabase.from("flow_monitor_state").delete().eq("flow_id", m.flow.id);
      const { error } = await supabase.from("automation_flows").delete().eq("id", m.flow.id);
      if (error) throw error;
      toast.success("Monitor excluído");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao excluir");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border bg-surface rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-accent/40 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <HealthDot health={m.health} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">@{m.handle || "(handle vazio)"}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground truncate">{m.flow.name}</span>
            <Badge variant="outline" className="text-[10px] font-normal uppercase tracking-wider">
              {m.flow.status}
            </Badge>
            <Badge variant="outline" className="text-[10px] font-normal">
              a cada {m.intervalMin}min
            </Badge>
            <Badge variant="outline" className="text-[10px] font-normal">
              modo: {m.selectMode}
            </Badge>
          </div>
          <p className={cn(
            "mt-1 text-xs truncate",
            m.health === "error" && "text-destructive",
            m.health === "warn" && "text-amber-600 dark:text-amber-400",
            (m.health === "ok" || m.health === "idle") && "text-muted-foreground",
          )}>
            {m.healthMsg}
          </p>
        </div>

        <div className="hidden md:flex flex-col items-end text-right shrink-0">
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Última leitura</span>
          <span className={cn("text-xs", isStale && "text-amber-600 dark:text-amber-400")}>{lastCheckedAgo}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border bg-background/40 px-5 py-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={toggleActive} disabled={busy}>
              {active ? <Pause className="h-3.5 w-3.5 mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
              {active ? "Pausar" : "Ativar"}
            </Button>
            <Button size="sm" variant="outline" onClick={cancelTasks} disabled={busy} title="Cancela as ações já enfileiradas deste monitor (não executa mais)">
              <Ban className="h-3.5 w-3.5 mr-1.5" /> Cancelar tarefas pendentes
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={deleteMonitor}
              disabled={busy}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 ml-auto"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Excluir monitor
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <InfoBlock label="Conta leitora">
              {m.reader ? (
                <span className="text-foreground">@{m.reader.username}</span>
              ) : (
                <span className="text-destructive">— (sem cookies válidos)</span>
              )}
            </InfoBlock>
            <InfoBlock label="Contas vinculadas">
              {m.linkedAccounts.length > 0 ? (
                <span className="text-foreground">
                  {m.linkedAccounts.map((a) => `@${a.username}`).join(", ")}
                </span>
              ) : (
                <span className="text-muted-foreground">nenhuma</span>
              )}
              {m.missingAccountIds.length > 0 && (
                <span className="text-destructive block mt-1">
                  {m.missingAccountIds.length} conta(s) deletada(s) ainda no fluxo
                </span>
              )}
            </InfoBlock>
            <InfoBlock label="Último tweet visto">
              {m.state?.last_tweet_id ? (
                <a
                  href={`https://x.com/${m.handle}/status/${m.state.last_tweet_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground font-mono hover:underline"
                >
                  {m.state.last_tweet_id}
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              <span className="block text-muted-foreground mt-1">
                {m.state?.processed_tweet_ids?.length ?? 0} tweet(s) processado(s)
              </span>
            </InfoBlock>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
              Logs recentes ({m.logs.length})
            </p>
            <div className="border border-border rounded-md max-h-80 overflow-auto">
              {m.logs.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Nenhum evento registrado ainda
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {m.logs.slice(0, 50).map((l) => (
                    <li key={l.id} className="px-4 py-2 flex items-start gap-3 text-xs">
                      <span className="text-muted-foreground whitespace-nowrap font-mono">
                        {new Date(l.created_at).toLocaleTimeString("pt-BR")}
                      </span>
                      <LevelBadge level={l.level} />
                      <span className="flex-1 text-foreground/90">{l.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type MonitorViewModel = {
  flow: FlowRow;
  handle: string;
  intervalMin: number;
  selectMode: string;
  linkedAccounts: AccountRow[];
  missingAccountIds: string[];
  reader: AccountRow | null;
  state: MonitorStateRow | null;
  logs: LogRow[];
  health: "ok" | "warn" | "error" | "idle";
  healthMsg: string;
};

function HealthDot({ health }: { health: "ok" | "warn" | "error" | "idle" }) {
  const color =
    health === "ok"
      ? "bg-emerald-500"
      : health === "warn"
      ? "bg-amber-500"
      : health === "error"
      ? "bg-red-500"
      : "bg-muted-foreground/40";
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {health === "ok" && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
      )}
      <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", color)} />
    </span>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: any;
  tone: "muted" | "success" | "warn" | "danger";
}) {
  const toneClass = {
    muted: "text-muted-foreground",
    success: "text-emerald-600 dark:text-emerald-400",
    warn: "text-amber-600 dark:text-amber-400",
    danger: "text-destructive",
  }[tone];
  return (
    <div className="border border-border bg-surface rounded-lg p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${toneClass}`} strokeWidth={1.5} />
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      </div>
      <p className={`mt-2 text-2xl font-light ${toneClass}`}>{value}</p>
    </div>
  );
}

function LevelBadge({ level }: { level: string }) {
  const variant: Record<string, "outline" | "destructive" | "secondary"> = {
    info: "outline",
    warn: "secondary",
    error: "destructive",
  };
  return (
    <Badge variant={variant[level] ?? "outline"} className="font-normal text-[10px] uppercase tracking-wider">
      {level}
    </Badge>
  );
}

function LinkifiedMsg({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="text-brand hover:underline break-all">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function InfoBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">{label}</p>
      <div>{children}</div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff) || diff < 0) return iso;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s atrás`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}
