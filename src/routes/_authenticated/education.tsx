import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { GraduationCap, Heart, Clock, Sparkles, Trash2, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/education")({
  component: EducationPage,
});

type Account = { id: string; username: string; status: string };
type EduRow = {
  twitter_account_id: string;
  user_id: string;
  enabled: boolean;
  keywords: string[];
  last_run_at: string | null;
};
type Task = {
  id: string;
  twitter_account_id: string;
  tweet_id: string;
  keyword: string | null;
  view_count: number;
  status: "pending" | "processing" | "completed" | "failed";
  scheduled_for: string;
  last_error: string | null;
  created_at: string;
};

function EducationPage() {
  const qc = useQueryClient();

  const accountsQ = useQuery({
    queryKey: ["edu_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("twitter_accounts")
        .select("id, username, status")
        .order("username");
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const eduQ = useQuery({
    queryKey: ["edu_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_education")
        .select("twitter_account_id, user_id, enabled, keywords, last_run_at");
      if (error) throw error;
      return (data ?? []) as EduRow[];
    },
    refetchInterval: 10000,
  });

  const tasksQ = useQuery({
    queryKey: ["edu_tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("education_tasks")
        .select("id, twitter_account_id, tweet_id, keyword, view_count, status, scheduled_for, last_error, created_at")
        .order("scheduled_for", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Task[];
    },
    refetchInterval: 5000,
  });

  const eduByAcc = useMemo(() => {
    const m = new Map<string, EduRow>();
    for (const r of eduQ.data ?? []) m.set(r.twitter_account_id, r);
    return m;
  }, [eduQ.data]);

  const tasksByAcc = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasksQ.data ?? []) {
      const arr = m.get(t.twitter_account_id) ?? [];
      arr.push(t);
      m.set(t.twitter_account_id, arr);
    }
    return m;
  }, [tasksQ.data]);

  const upsert = useMutation({
    mutationFn: async (payload: { account_id: string; enabled?: boolean; keywords?: string[] }) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const existing = eduByAcc.get(payload.account_id);
      const row = {
        twitter_account_id: payload.account_id,
        user_id: u.user.id,
        enabled: payload.enabled ?? existing?.enabled ?? true,
        keywords: payload.keywords ?? existing?.keywords ?? [],
      };
      const { error } = await supabase.from("account_education").upsert(row, { onConflict: "twitter_account_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["edu_settings"] }),
    onError: (e: any) => toast.error(e.message),
  });

  const totalTasks = tasksQ.data?.length ?? 0;
  const pendingTasks = (tasksQ.data ?? []).filter((t) => t.status === "pending").length;
  const completedTasks = (tasksQ.data ?? []).filter((t) => t.status === "completed").length;

  return (
    <div className="px-10 py-10 max-w-7xl mx-auto">
      <PageHeader
        eyebrow="Aquecimento"
        title="Educar conta"
        description="A cada 30 min escolhemos uma palavra-chave aleatória, buscamos os tweets mais vistos dos últimos 30 min e curtimos um a cada 2:30 para simular atividade humana real."
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-8">
        <Stat label="Contas em educação" value={(eduQ.data ?? []).filter((r) => r.enabled && r.keywords.length).length} icon={GraduationCap} />
        <Stat label="Likes na fila" value={pendingTasks} icon={Clock} tone="warn" />
        <Stat label="Curtidos" value={completedTasks} icon={Heart} tone="success" />
        <Stat label="Total recente" value={totalTasks} icon={Sparkles} />
        <NextSweepStat edu={eduQ.data ?? []} />
      </div>


      <div className="mt-8 space-y-3">
        {accountsQ.isLoading ? (
          <div className="text-center text-sm text-muted-foreground py-10">Carregando…</div>
        ) : (accountsQ.data ?? []).length === 0 ? (
          <div className="border border-border bg-surface rounded-lg p-10 text-center text-sm text-muted-foreground">
            Nenhuma conta cadastrada. Adicione uma conta primeiro em "Contas & Proxies".
          </div>
        ) : (
          (accountsQ.data ?? []).map((acc) => (
            <AccountCard
              key={acc.id}
              account={acc}
              edu={eduByAcc.get(acc.id) ?? null}
              tasks={tasksByAcc.get(acc.id) ?? []}
              onChange={(payload) => upsert.mutate({ account_id: acc.id, ...payload })}
              saving={upsert.isPending}
            />
          ))
        )}
      </div>
    </div>
  );
}

function AccountCard({
  account, edu, tasks, onChange, saving,
}: {
  account: Account;
  edu: EduRow | null;
  tasks: Task[];
  onChange: (p: { enabled?: boolean; keywords?: string[] }) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState("");
  const enabled = edu?.enabled ?? false;
  const keywords = edu?.keywords ?? [];
  const pending = tasks.filter((t) => t.status === "pending").length;
  const done = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  // re-render every 30s so countdowns update live
  useTick(30_000);


  function addKeyword() {
    const v = draft.trim();
    if (!v) return;
    if (keywords.includes(v)) { setDraft(""); return; }
    onChange({ keywords: [...keywords, v] });
    setDraft("");
  }
  function remove(k: string) {
    onChange({ keywords: keywords.filter((x) => x !== k) });
  }

  return (
    <div className="border border-border bg-surface rounded-lg p-5">
      <div className="flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-foreground">@{account.username}</span>
            <Badge variant="outline" className="text-[10px] font-normal uppercase tracking-wider">
              {account.status}
            </Badge>
            {edu?.last_run_at && (
              <span className="text-xs text-muted-foreground">
                · última varredura {timeAgo(edu.last_run_at)}
              </span>
            )}
            {enabled && keywords.length > 0 && (
              <Badge variant="outline" className="text-[10px] font-normal gap-1">
                <Clock className="h-3 w-3" />
                próxima varredura {formatNextSweep(edu?.last_run_at)}
              </Badge>
            )}
          </div>

          <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
            <span><span className="text-amber-500">{pending}</span> na fila</span>
            <span><span className="text-emerald-500">{done}</span> curtidos</span>
            {failed > 0 && <span><span className="text-destructive">{failed}</span> falhas</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <span className="text-xs text-muted-foreground">{enabled ? "Ativo" : "Pausado"}</span>
          <Switch checked={enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
        </div>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
          Palavras-chave ({keywords.length})
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {keywords.length === 0 && (
            <span className="text-xs text-muted-foreground italic">Nenhuma — adicione abaixo para começar.</span>
          )}
          {keywords.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-md border border-border bg-background text-xs"
            >
              {k}
              <button
                onClick={() => remove(k)}
                className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-destructive"
                aria-label="Remover"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())}
            placeholder='ex: "marketing digital", "$BTC", "from:elonmusk lang:pt"'
            className="text-sm"
          />
          <Button onClick={addKeyword} variant="outline" size="sm">
            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Suporta operadores do X (lang:pt, min_faves:50, from:user, etc.). Uma é sorteada por execução.
        </p>
      </div>

      {tasks.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-2">
            Últimos tweets ({tasks.length})
          </p>
          <ul className="divide-y divide-border max-h-72 overflow-auto border border-border rounded-md">
            {tasks.slice(0, 30).map((t) => (
              <li key={t.id} className="px-3 py-2 flex items-center gap-3 text-xs">
                <StatusDot status={t.status} />
                <span className="text-muted-foreground font-mono text-[10px] whitespace-nowrap">
                  {new Date(t.scheduled_for).toLocaleTimeString("pt-BR")}
                </span>
                {t.keyword && (
                  <Badge variant="outline" className="font-normal text-[10px]">{t.keyword}</Badge>
                )}
                <a
                  href={`https://x.com/i/status/${t.tweet_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-foreground/80 hover:underline truncate"
                >
                  {t.tweet_id}
                </a>
                <span className="ml-auto text-muted-foreground whitespace-nowrap">
                  {formatViews(t.view_count)} views
                </span>
                {t.status === "failed" && t.last_error && (
                  <span className="text-destructive truncate max-w-[200px]" title={t.last_error}>
                    {t.last_error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: Task["status"] }) {
  const c =
    status === "completed" ? "bg-emerald-500"
    : status === "failed" ? "bg-red-500"
    : status === "processing" ? "bg-blue-500 animate-pulse"
    : "bg-amber-500";
  return <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", c)} />;
}

function Stat({ label, value, icon: Icon, tone = "muted" }: { label: string; value: number; icon: any; tone?: "muted" | "success" | "warn" }) {
  const t = tone === "success" ? "text-emerald-600 dark:text-emerald-400"
          : tone === "warn" ? "text-amber-600 dark:text-amber-400"
          : "text-muted-foreground";
  return (
    <div className="border border-border bg-surface rounded-lg p-4">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${t}`} strokeWidth={1.5} />
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      </div>
      <p className={`mt-2 text-2xl font-light ${t}`}>{value}</p>
    </div>
  );
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s atrás`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}min atrás`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h atrás`;
  return `${Math.round(h / 24)}d atrás`;
}

// Cron roda o endpoint /api/public/hooks/education a cada 5 min.
// Cada conta tem seu próprio ciclo de 30 min baseado em last_run_at.
const SWEEP_INTERVAL_MIN = 30;
const CRON_TICK_MIN = 5;

function formatNextSweep(lastRunAt: string | null | undefined): string {
  if (!lastRunAt) return "no próximo tick (≤5min)";
  const nextMs = Date.parse(lastRunAt) + SWEEP_INTERVAL_MIN * 60_000;
  const diff = nextMs - Date.now();
  if (diff <= 0) return "no próximo tick (≤5min)";
  const totalMin = Math.ceil(diff / 60_000);
  if (totalMin <= 1) return "em <1min";
  if (totalMin < 60) return `em ${totalMin}min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `em ${h}h${m}min` : `em ${h}h`;
}

function useTick(ms: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

function NextSweepStat({ edu }: { edu: EduRow[] }) {
  useTick(15_000);
  const active = edu.filter((r) => r.enabled && r.keywords.length > 0);
  if (active.length === 0) {
    return (
      <div className="border border-border bg-surface rounded-lg p-4">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Próxima varredura</p>
        </div>
        <p className="mt-2 text-2xl font-light text-muted-foreground">—</p>
        <p className="text-[10px] text-muted-foreground mt-1">Nenhuma conta ativa</p>
      </div>
    );
  }
  // Primeira conta que será varrida (menor "próximo ms").
  const next = active
    .map((r) => ({
      r,
      nextMs: r.last_run_at ? Date.parse(r.last_run_at) + SWEEP_INTERVAL_MIN * 60_000 : 0,
    }))
    .sort((a, b) => a.nextMs - b.nextMs)[0];
  const label = formatNextSweep(next.r.last_run_at);
  return (
    <div className="border border-border bg-surface rounded-lg p-4">
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-foreground" strokeWidth={1.5} />
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Próxima varredura</p>
      </div>
      <p className="mt-2 text-2xl font-light text-foreground">{label}</p>
      <p className="text-[10px] text-muted-foreground mt-1">
        Worker roda a cada {CRON_TICK_MIN}min · ciclo {SWEEP_INTERVAL_MIN}min por conta
      </p>
    </div>
  );
}
