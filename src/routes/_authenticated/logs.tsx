import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RefreshCw, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/logs")({
  component: LogsPage,
});

function LogsPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);

  const logsQuery = useQuery({
    queryKey: ["execution_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("execution_logs")
        .select("*, flow:automation_flows(name), account:twitter_accounts(username)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const queueQuery = useQuery({
    queryKey: ["execution_queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("execution_queue")
        .select("*, flow:automation_flows(name), account:twitter_accounts(username)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const statsQuery = useQuery({
    queryKey: ["execution_queue_stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("execution_queue")
        .select("status");
      if (error) throw error;
      const counts = { pending: 0, processing: 0, completed: 0, failed: 0 } as Record<string, number>;
      for (const r of data ?? []) counts[r.status as string] = (counts[r.status as string] ?? 0) + 1;
      return counts;
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

  function refreshAll() {
    logsQuery.refetch();
    queueQuery.refetch();
    statsQuery.refetch();
  }

  async function retryFailed(id: string) {
    const { error } = await supabase
      .from("execution_queue")
      .update({ status: "pending", attempts: 0, last_error: null, scheduled_for: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Tarefa re-enfileirada");
    queueQuery.refetch();
  }

  async function clearCompleted() {
    const { error } = await supabase.from("execution_queue").delete().eq("status", "completed");
    if (error) return toast.error(error.message);
    toast.success("Limpeza concluída");
    refreshAll();
  }

  const stats = statsQuery.data ?? { pending: 0, processing: 0, completed: 0, failed: 0 };

  // Ações que deram certo (tweet/RT/like/comentário publicado).
  const successLogs = (logsQuery.data ?? []).filter(
    (l: any) => l.level === "info" && /^(💬|🔁|❤️)|publicado/.test(l.message ?? ""),
  );

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-7xl mx-auto">
      <div className="flex items-start justify-between">
        <PageHeader
          eyebrow="Observabilidade"
          title="Logs & fila de execução"
          description="Veja em tempo real o que os workers estão fazendo, o que está travado e o que falhou."
        />
        <div className="flex items-center gap-2 mt-2">
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

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
        <StatCard label="Pending" value={stats.pending} icon={Clock} tone="muted" />
        <StatCard label="Processing" value={stats.processing} icon={Loader2} tone="info" spin={stats.processing > 0} />
        <StatCard label="Completed" value={stats.completed} icon={CheckCircle2} tone="success" />
        <StatCard label="Failed" value={stats.failed} icon={XCircle} tone="danger" />
      </div>

      <Tabs defaultValue="success" className="mt-8">
        <TabsList>
          <TabsTrigger value="success">✓ Sucessos ({successLogs.length})</TabsTrigger>
          <TabsTrigger value="queue">Fila ({queueQuery.data?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="logs">Eventos ({logsQuery.data?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="success" className="mt-4">
          <div className="border border-emerald-500/15 bg-emerald-500/[0.03] rounded-lg overflow-hidden">
            {successLogs.length === 0 ? (
              <EmptyHint title="Nenhuma ação concluída ainda" hint="Quando uma conta postar, retweetar, curtir ou comentar com sucesso, aparece aqui com o link pra ver no X." />
            ) : (
              <div className="divide-y divide-border max-h-[60vh] overflow-auto">
                {successLogs.map((l: any) => (
                  <div key={l.id} className="px-4 py-2.5 flex items-start gap-3 text-xs">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                    <span className="text-muted-foreground whitespace-nowrap font-mono">
                      {new Date(l.created_at).toLocaleString("pt-BR", { hour12: false })}
                    </span>
                    <span className="flex-1 text-foreground/90 break-words"><LinkifiedMsg text={l.message} /></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="queue" className="mt-4">
          <div className="flex justify-end mb-2">
            <Button variant="ghost" size="sm" onClick={clearCompleted} disabled={stats.completed === 0}>
              Limpar concluídas
            </Button>
          </div>
          <div className="border border-border bg-surface rounded-lg overflow-x-auto">
            {(!queueQuery.data || queueQuery.data.length === 0) ? (
              <EmptyHint
                title="Nenhuma tarefa na fila"
                hint="Quando um trigger dispara, as ações aparecem aqui. Se sua fila está vazia mas o fluxo está ativo, o agendador (pg_cron) provavelmente não está chamando o parser — só roda quando você clica 'Salvar e ativar'."
              />
            ) : (
              <table className="w-full text-sm min-w-[560px]">
                <thead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left px-5 py-3 font-normal">Status</th>
                    <th className="text-left px-5 py-3 font-normal">Fluxo</th>
                    <th className="text-left px-5 py-3 font-normal">Ação</th>
                    <th className="text-left px-5 py-3 font-normal">Conta</th>
                    <th className="text-left px-5 py-3 font-normal">Agendado</th>
                    <th className="text-left px-5 py-3 font-normal">Tentativas</th>
                    <th className="text-left px-5 py-3 font-normal">Erro</th>
                    <th className="text-right px-5 py-3 font-normal">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {queueQuery.data.map((q: any) => (
                    <tr key={q.id}>
                      <td className="px-5 py-3"><StatusBadge status={q.status} /></td>
                      <td className="px-5 py-3 text-xs">{q.flow?.name || "—"}</td>
                      <td className="px-5 py-3 text-xs font-mono text-muted-foreground">{q.action_type}</td>
                      <td className="px-5 py-3 text-xs">{q.account?.username ? `@${q.account.username}` : "—"}</td>
                      <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(q.scheduled_for).toLocaleString("pt-BR")}</td>
                      <td className="px-5 py-3 text-xs">{q.attempts}</td>
                      <td className="px-5 py-3 text-xs text-destructive max-w-[200px] truncate" title={q.last_error || ""}>{q.last_error || "—"}</td>
                      <td className="px-5 py-3 text-right">
                        {q.status === "failed" && (
                          <Button variant="ghost" size="sm" onClick={() => retryFailed(q.id)}>Retry</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Info: tarefas pendentes aguardam horário/worker (não é erro) */}
          {stats.pending > 0 && (
            <div className="mt-4 flex gap-3 p-4 border border-border bg-muted/30 rounded-lg text-sm">
              <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
              <div>
                <p className="font-medium text-foreground">
                  {stats.pending} tarefa(s) na fila aguardando.
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Tarefas pendentes esperam o <b>horário agendado</b> (delays humanizados) ou o próximo ciclo do worker,
                  que roda <b>automaticamente a cada 1 minuto</b> via pg_cron. Quando o horário chega, são executadas
                  sozinhas. Isso é normal — não é erro.
                </p>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <div className="border border-border bg-surface rounded-lg overflow-x-auto">
            {(!logsQuery.data || logsQuery.data.length === 0) ? (
              <EmptyHint title="Sem eventos" hint="Workers e o parser de fluxos gravam aqui. Se está vazio, nada foi executado." />
            ) : (
              <table className="w-full text-sm min-w-[560px]">
                <thead className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground bg-muted/40">
                  <tr>
                    <th className="text-left px-5 py-3 font-normal">Quando</th>
                    <th className="text-left px-5 py-3 font-normal">Nível</th>
                    <th className="text-left px-5 py-3 font-normal">Fluxo</th>
                    <th className="text-left px-5 py-3 font-normal">Conta</th>
                    <th className="text-left px-5 py-3 font-normal">Mensagem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logsQuery.data.map((l: any) => (
                    <tr key={l.id}>
                      <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString("pt-BR")}</td>
                      <td className="px-5 py-3"><LevelBadge level={l.level} /></td>
                      <td className="px-5 py-3 text-xs">{l.flow?.name || "—"}</td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{l.account?.username ? `@${l.account.username}` : "—"}</td>
                      <td className="px-5 py-3 text-sm">{l.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, tone, spin }: { label: string; value: number; icon: any; tone: "muted" | "info" | "success" | "danger"; spin?: boolean }) {
  const toneClass = {
    muted: "text-muted-foreground",
    info: "text-blue-600 dark:text-blue-400",
    success: "text-emerald-600 dark:text-emerald-400",
    danger: "text-destructive",
  }[tone];
  return (
    <div className="border border-border bg-surface rounded-lg p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${toneClass} ${spin ? "animate-spin" : ""}`} strokeWidth={1.5} />
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      </div>
      <p className={`mt-2 text-2xl font-light ${toneClass}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-muted text-foreground",
    processing: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    failed: "bg-destructive/15 text-destructive",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase tracking-wider ${map[status] ?? "bg-muted"}`}>{status}</span>;
}

function LevelBadge({ level }: { level: string }) {
  const variant: Record<string, "outline" | "destructive" | "secondary"> = {
    info: "outline",
    warn: "secondary",
    error: "destructive",
  };
  return <Badge variant={variant[level] ?? "outline"} className="font-normal text-[10px] uppercase tracking-wider">{level}</Badge>;
}

function LinkifiedMsg({ text }: { text: string }) {
  const parts = (text ?? "").split(/(https?:\/\/\S+)/g);
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

function EmptyHint({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="p-10 text-center">
      <p className="text-sm text-foreground">{title}</p>
      <p className="mt-2 text-xs text-muted-foreground max-w-md mx-auto">{hint}</p>
    </div>
  );
}
