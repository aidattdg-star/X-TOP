import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { testMonitorTargets } from "@/lib/monitoring.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Send, Repeat2, MessageCircle, Zap, Check, Loader2, CheckCircle2, XCircle, Heart, Flame, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Account = { id: string; username: string };
type ActionType = "action.post_tweet" | "action.retweet" | "action.comment";

const ACTIONS: {
  value: ActionType;
  label: string;
  icon: typeof Send;
  needsText: boolean;
  hint: string;
}[] = [
  {
    value: "action.post_tweet",
    label: "Postar tweet",
    icon: Send,
    needsText: true,
    hint: "Suas contas publicam o texto abaixo (próprio tweet).",
  },
  {
    value: "action.retweet",
    label: "Retweetar",
    icon: Repeat2,
    needsText: false,
    hint: "Suas contas dão RT no novo tweet do alvo.",
  },
  {
    value: "action.comment",
    label: "Comentar",
    icon: MessageCircle,
    needsText: true,
    hint: "Suas contas respondem o novo tweet do alvo com o texto abaixo.",
  },
];

function uid() {
  return "node_" + Math.random().toString(36).slice(2, 10);
}

function StepLabel({ n, text }: { n: number; text: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full gradient-brand text-white text-[10px] font-semibold">{n}</span>
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{text}</span>
    </span>
  );
}

export function CreateMonitorModal({
  open,
  onOpenChange,
  accounts,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accounts: Account[];
}) {
  const qc = useQueryClient();
  const runTest = useServerFn(testMonitorTargets);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<{ handle: string; ok: boolean; name?: string; error?: string }[] | null>(null);
  const [targets, setTargets] = useState("");
  const [action, setAction] = useState<ActionType>("action.post_tweet");
  const [text, setText] = useState("");
  const [intervalMin, setIntervalMin] = useState(3);
  const [intervalMax, setIntervalMax] = useState(12);
  const [testMode, setTestMode] = useState(false);
  const [rotateOn, setRotateOn] = useState(false);
  const [rotateEvery, setRotateEvery] = useState(10);
  const [likeBefore, setLikeBefore] = useState(true);
  const [warmOnAct, setWarmOnAct] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Pastas + a qual pasta cada conta pertence (pra selecionar por pasta).
  const { data: folders = [] } = useQuery({
    queryKey: ["account_folders"],
    queryFn: async () => {
      const { data } = await supabase.from("account_folders").select("id, name").order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });
  const { data: folderMap = {} } = useQuery({
    queryKey: ["monitor_account_folder_map"],
    queryFn: async () => {
      const { data } = await supabase.from("twitter_accounts").select("id, folder_id").neq("status", "banned");
      const m: Record<string, string | null> = {};
      for (const a of data ?? []) m[(a as any).id] = (a as any).folder_id ?? null;
      return m;
    },
  });

  const actionMeta = ACTIONS.find((a) => a.value === action)!;
  const handles = targets
    .split(/[\n,;\s]+/)
    .map((h) => h.replace(/^@/, "").trim())
    .filter(Boolean);

  // Contas (do prop) que pertencem a uma "visão": "__all__" | "__none__" | folderId
  function accountIdsOf(view: string): string[] {
    return accounts
      .filter((a) =>
        view === "__all__" ? true : view === "__none__" ? !folderMap[a.id] : folderMap[a.id] === view,
      )
      .map((a) => a.id);
  }
  function folderFullyOn(view: string): boolean {
    const ids = accountIdsOf(view);
    return ids.length > 0 && ids.every((id) => selected.includes(id));
  }
  function toggleFolder(view: string) {
    const ids = accountIdsOf(view);
    setSelected((s) =>
      folderFullyOn(view) ? s.filter((id) => !ids.includes(id)) : [...new Set([...s, ...ids])],
    );
  }

  async function handleTest() {
    if (!handles.length) return toast.error("Cole ao menos um @ alvo para testar.");
    // dedup e testa em lotes de 20 (limite do servidor) — funciona com qualquer quantidade
    const uniq = Array.from(new Set(handles));
    setTesting(true);
    setTestResults([]);
    try {
      const all: { handle: string; ok: boolean; name?: string; error?: string }[] = [];
      for (let i = 0; i < uniq.length; i += 20) {
        const chunk = uniq.slice(i, i + 20);
        const r = await runTest({ data: { handles: chunk } });
        all.push(...r.results);
        setTestResults([...all]); // resultado progressivo
      }
      const ok = all.filter((x) => x.ok).length;
      if (ok === all.length) toast.success(`Todos os ${ok} @ alvo(s) existem ✓`);
      else toast.warning(`${ok}/${all.length} ok · ${all.length - ok} não encontrado(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao testar");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!handles.length) return toast.error("Cole ao menos um @ alvo para monitorar.");
    if (!selected.length) return toast.error("Selecione ao menos uma das suas contas para agir.");
    if (actionMeta.needsText && !text.trim()) return toast.error("Escreva o texto da ação.");

    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");

      const effMin = testMode ? 1 : Math.max(1, intervalMin);
      const effMax = testMode ? 1 : Math.max(effMin, intervalMax);
      const rows = handles.map((handle) => {
        const triggerId = uid();
        const actionId = uid();
        const actionConfig: Record<string, unknown> = {};
        if (actionMeta.needsText) actionConfig.text = text.trim();
        // Curtir antes de comentar/retweetar (sequência humana). Não se aplica a "Postar tweet".
        if (action !== "action.post_tweet") {
          actionConfig.like_before = likeBefore;
          actionConfig.warm_on_act = warmOnAct;
        }
        return {
          user_id: u.user!.id,
          name: `Monitor @${handle}`,
          description: `Monitora @${handle} e ${actionMeta.label.toLowerCase()} (a cada ${effMin}–${effMax}min, humano)`,
          status: "active" as const,
          execution_interval: null,
          account_ids: selected,
          react_flow_data: {
            nodes: [
              {
                id: triggerId,
                type: "flowNode",
                position: { x: 120, y: 160 },
                data: {
                  kind: "trigger.monitor_account",
                  label: `Monitorar @${handle}`,
                  config: {
                    account: handle,
                    interval_min: effMin,
                    interval_max: effMax,
                    interval_minutes: effMin,
                    select_mode: "last",
                    rotate: rotateOn,
                    rotate_every: Math.max(1, rotateEvery),
                  },
                },
              },
              {
                id: actionId,
                type: "flowNode",
                position: { x: 440, y: 160 },
                data: { kind: action, label: actionMeta.label, config: actionConfig },
              },
            ],
            edges: [{ id: `e_${triggerId}_${actionId}`, source: triggerId, target: actionId }],
          },
        };
      });

      const { error } = await supabase.from("automation_flows").insert(rows as never); // react_flow_data é Json no schema; o literal tipado dispara variância
      if (error) throw error;

      toast.success(`${rows.length} monitor(es) criado(s) e ativado(s)`);
      qc.invalidateQueries({ queryKey: ["monitoring_flows"] });
      onOpenChange(false);
      setTargets("");
      setText("");
      setSelected([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar monitor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85dvh] overflow-y-auto overflow-x-hidden overscroll-contain">
        <DialogHeader>
          <DialogTitle className="font-light text-xl">Novo monitor</DialogTitle>
          <DialogDescription>
            Suas contas reagem depois que o alvo postar um tweet novo — checando em intervalos{" "}
            {testMode
              ? "de teste (~1 min)"
              : `humanos (${intervalMin}–${intervalMax} min, aleatório)`}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-1 min-w-0">
          <div className="space-y-1.5">
            <StepLabel n={1} text="Quem monitorar (@ alvo)" />
            <Textarea
              rows={2}
              value={targets}
              onChange={(e) => { setTargets(e.target.value); setTestResults(null); }}
              placeholder="@usuario1  @usuario2 …"
              className="font-mono text-xs bg-white/[0.04] border-white/10 focus-visible:border-brand/40 resize-none"
            />
            {handles.length > 0 && (
              <div className="flex items-center justify-between gap-2 min-w-0">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground truncate">
                  {handles.length} alvo(s): {handles.map((h) => "@" + h).join(", ")}
                </p>
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-brand/20 transition-colors disabled:opacity-50"
                >
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {testing ? "Testando…" : "Testar @ alvos"}
                </button>
              </div>
            )}
            {testResults && (
              <div className="rounded-lg border border-white/10 bg-white/[0.02] divide-y divide-white/[0.05] overflow-hidden">
                {testResults.map((r) => (
                  <div key={r.handle} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                    {r.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                    )}
                    <span className="text-foreground">@{r.handle}</span>
                    <span className="text-muted-foreground truncate flex-1">
                      {r.ok ? (r.name ? `· ${r.name}` : "· existe") : `· ${r.error ?? "não encontrado"}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <StepLabel n={2} text="O que suas contas fazem" />
            <div className="grid grid-cols-3 gap-2">
              {ACTIONS.map((a) => {
                const Icon = a.icon;
                const on = action === a.value;
                return (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => setAction(a.value)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-[11px] font-medium transition-all text-center",
                      on
                        ? "border-brand/50 bg-brand/10 text-foreground shadow-[0_0_0_1px_oklch(0.66_0.2_285_/_0.25)]"
                        : "border-white/10 text-muted-foreground hover:text-foreground hover:border-brand/30 hover:bg-white/[0.03]",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", on ? "text-brand" : "text-muted-foreground")} strokeWidth={1.75} />
                    <span className="truncate">{a.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{actionMeta.hint}</p>
            {action !== "action.post_tweet" && (
              <button
                type="button"
                onClick={() => setLikeBefore(!likeBefore)}
                className={cn(
                  "flex items-center gap-2.5 w-full rounded-xl border px-3 py-2.5 transition-colors text-left mt-1",
                  likeBefore ? "border-brand/50 bg-brand/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]",
                )}
              >
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", likeBefore ? "gradient-brand text-white" : "bg-white/[0.06] text-muted-foreground")}>
                  <Heart className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1">
                  <span className="block text-xs font-medium text-foreground">Curtir antes de {action === "action.comment" ? "comentar" : "retweetar"}</span>
                  <span className="block text-[11px] text-muted-foreground">sequência humana (curtir → agir) — gera mais confiança e menos cara de bot</span>
                </span>
                <span className={cn("h-4 w-4 rounded-full border-2 grid place-items-center", likeBefore ? "border-brand" : "border-white/20")}>
                  {likeBefore && <span className="h-2 w-2 rounded-full gradient-brand" />}
                </span>
              </button>
            )}
            {action !== "action.post_tweet" && (
              <button
                type="button"
                onClick={() => setWarmOnAct(!warmOnAct)}
                className={cn(
                  "flex items-center gap-2.5 w-full rounded-xl border px-3 py-2.5 transition-colors text-left",
                  warmOnAct ? "border-brand/50 bg-brand/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]",
                )}
              >
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", warmOnAct ? "gradient-brand text-white" : "bg-white/[0.06] text-muted-foreground")}>
                  <Flame className="h-3.5 w-3.5" />
                </span>
                <span className="flex-1">
                  <span className="block text-xs font-medium text-foreground">Aquecer ao agir</span>
                  <span className="block text-[11px] text-muted-foreground">antes de agir, a conta dá uma lida rápida no feed — sinal de sessão ativa (deixa um pouco mais lento)</span>
                </span>
                <span className={cn("h-4 w-4 rounded-full border-2 grid place-items-center", warmOnAct ? "border-brand" : "border-white/20")}>
                  {warmOnAct && <span className="h-2 w-2 rounded-full gradient-brand" />}
                </span>
              </button>
            )}
          </div>

          {actionMeta.needsText && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Texto
              </Label>
              <Textarea
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Texto… variações com {a|b} e |||  para evitar duplicidade"
                className="bg-white/[0.04] border-white/10 focus-visible:border-brand/40 resize-none"
              />
            </div>
          )}

          <div className="space-y-2">
            <StepLabel n={3} text="Com que frequência checar" />
            <button
              type="button"
              onClick={() => setTestMode(!testMode)}
              className={cn(
                "flex items-center gap-2.5 w-full rounded-xl border px-3 py-2.5 transition-colors text-left",
                testMode ? "border-brand/50 bg-brand/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]",
              )}
            >
              <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", testMode ? "gradient-brand text-white" : "bg-white/[0.06] text-muted-foreground")}>
                <Zap className="h-3.5 w-3.5" />
              </span>
              <span className="flex-1">
                <span className="block text-xs font-medium text-foreground">Modo teste</span>
                <span className="block text-[11px] text-muted-foreground">checa a cada ~1 min (pra ver rápido)</span>
              </span>
              <span className={cn("h-4 w-4 rounded-full border-2 grid place-items-center", testMode ? "border-brand" : "border-white/20")}>
                {testMode && <span className="h-2 w-2 rounded-full gradient-brand" />}
              </span>
            </button>
            {!testMode && (
              <div className="flex items-end gap-2 pt-1">
                <div className="space-y-1">
                  <span className="block text-[10px] text-muted-foreground">mín</span>
                  <Input
                    type="number"
                    min={1}
                    max={240}
                    value={intervalMin}
                    onChange={(e) => setIntervalMin(Math.max(1, Number(e.target.value) || 1))}
                    className="h-9 w-20 bg-white/[0.04] border-white/10 focus-visible:border-brand/40 text-center"
                  />
                </div>
                <span className="text-muted-foreground pb-2">a</span>
                <div className="space-y-1">
                  <span className="block text-[10px] text-muted-foreground">máx</span>
                  <Input
                    type="number"
                    min={1}
                    max={240}
                    value={intervalMax}
                    onChange={(e) => setIntervalMax(Math.max(1, Number(e.target.value) || 1))}
                    className="h-9 w-20 bg-white/[0.04] border-white/10 focus-visible:border-brand/40 text-center"
                  />
                </div>
                <span className="text-xs text-muted-foreground pb-2">
                  minutos (valor quebrado a cada ciclo)
                </span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              O app checa em intervalos <b>aleatórios</b> entre mín e máx (nunca redondo, mais
              humano). No modo teste, ~1 min pra você ver rápido.
            </p>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-90")} />
              Opções avançadas (rodízio)
            </button>
            {advancedOpen && (
            <div className="space-y-2 pt-1">
            <button
              type="button"
              onClick={() => setRotateOn(!rotateOn)}
              className={cn(
                "flex items-center gap-2.5 w-full rounded-xl border px-3 py-2.5 transition-colors text-left",
                rotateOn ? "border-brand/50 bg-brand/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]",
              )}
            >
              <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", rotateOn ? "gradient-brand text-white" : "bg-white/[0.06] text-muted-foreground")}>
                <Repeat2 className="h-3.5 w-3.5" />
              </span>
              <span className="flex-1">
                <span className="block text-xs font-medium text-foreground">Ativar rodízio</span>
                <span className="block text-[11px] text-muted-foreground">só 1 conta age por vez; troca pra próxima a cada N ações</span>
              </span>
              <span className={cn("h-4 w-4 rounded-full border-2 grid place-items-center", rotateOn ? "border-brand" : "border-white/20")}>
                {rotateOn && <span className="h-2 w-2 rounded-full gradient-brand" />}
              </span>
            </button>
            {rotateOn && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-muted-foreground">Trocar de conta a cada</span>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={rotateEvery}
                  onChange={(e) => setRotateEvery(Math.max(1, Number(e.target.value) || 1))}
                  className="h-9 w-20 bg-white/[0.04] border-white/10 focus-visible:border-brand/40 text-center"
                />
                <span className="text-xs text-muted-foreground">ação(ões)</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Com rodízio, a cada tweet novo do alvo só <b>uma</b> conta age. Quando ela atinge {rotateOn ? rotateEvery : "N"} ações, passa pra próxima — assim nenhuma conta spama tudo.
            </p>
            </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <StepLabel n={4} text="Quais pastas de contas vão agir" />
              <span className="text-[11px] text-muted-foreground">
                <b className="text-foreground tabular-nums">{selected.length}</b> conta(s)
              </span>
            </div>
            {accounts.length === 0 ? (
              <p className="text-xs text-muted-foreground border border-white/10 rounded-xl p-4 text-center">
                Nenhuma conta cadastrada ainda. Adicione contas em "Contas &amp; Proxies".
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {(() => {
                    const chips = [{ key: "__all__", name: "Todas" }];
                    if (accountIdsOf("__none__").length) chips.push({ key: "__none__", name: "Sem pasta" });
                    for (const f of folders) if (accountIdsOf(f.id).length) chips.push({ key: f.id, name: f.name });
                    return chips.map((c) => {
                      const ids = accountIdsOf(c.key);
                      const full = ids.length > 0 && ids.every((id) => selected.includes(id));
                      const some = !full && ids.some((id) => selected.includes(id));
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => toggleFolder(c.key)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors",
                            full
                              ? "gradient-brand text-white border-transparent"
                              : some
                                ? "border-brand/45 text-foreground bg-brand/10"
                                : "border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20",
                          )}
                        >
                          {full && <Check className="h-3 w-3" strokeWidth={3} />}
                          {c.name}
                          <span className={cn("tabular-nums", full ? "text-white/80" : "opacity-70")}>{ids.length}</span>
                        </button>
                      );
                    });
                  })()}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Clique numa <b>pasta</b> pra incluir/remover todas as contas dela. As contas dessas pastas é que vão reagir ao alvo.
                </p>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="mt-5">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving} className="gradient-brand text-white hover:opacity-90 border-0">
            {saving ? "Criando…" : `Criar ${handles.length || ""} monitor(es)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
