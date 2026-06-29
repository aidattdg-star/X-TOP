import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Plus, Trash2, Rocket, Heart, Repeat2, Link as LinkIcon, Users2, MessageCircle,
  Zap, Timer, Rabbit, Footprints, Turtle, Moon, Gauge,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { runMassEngage } from "@/lib/mass-engage.functions";

export const Route = createFileRoute("/_authenticated/mass-engage")({
  component: MassEnagePage,
});

type Account = { id: string; username: string; status: string | null; cooldown_until?: string | null };
type Block = { id: string; tweet_url: string; account_ids: string[] };

// Presets de ritmo (rápido/lento/etc) — mesmo conceito do "Postar tweet".
type SpeedKey = "instant" | "fast" | "human" | "slow" | "veryslow" | "custom";
const SPEEDS: { key: Exclude<SpeedKey, "custom">; label: string; desc: string; icon: any; instant?: boolean; min?: number; max?: number }[] = [
  { key: "instant", label: "Instantâneo", desc: "na hora, sem delay", icon: Zap, instant: true },
  { key: "fast", label: "Rápido", desc: "1–3 min", icon: Rabbit, min: 1, max: 3 },
  { key: "human", label: "Humanizado", desc: "2–10 min", icon: Footprints, min: 2, max: 10 },
  { key: "slow", label: "Lento", desc: "10–30 min", icon: Turtle, min: 10, max: 30 },
  { key: "veryslow", label: "Muito lento", desc: "30–90 min", icon: Moon, min: 30, max: 90 },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function MassEnagePage() {
  const run = useServerFn(runMassEngage);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["mass-engage-accounts"],
    refetchInterval: 30000,
    queryFn: async () => {
      await supabase.auth.getSession();
      const { data, error } = await supabase
        .from("twitter_accounts")
        .select("id, username, status, cooldown_until")
        .order("username");
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const isCooling = (a: Account) => !!a.cooldown_until && Date.parse(a.cooldown_until) > Date.now();

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.status !== "banned" && !isCooling(a)),
    [accounts],
  );
  const coolingAccounts = useMemo(
    () => accounts.filter((a) => a.status !== "banned" && isCooling(a)),
    [accounts],
  );

  const [blocks, setBlocks] = useState<Block[]>([
    { id: uid(), tweet_url: "", account_ids: [] },
  ]);
  const [doLike, setDoLike] = useState(true);
  const [doRetweet, setDoRetweet] = useState(true);
  const [doComment, setDoComment] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [instant, setInstant] = useState(false);
  const [speed, setSpeed] = useState<SpeedKey>("human");
  const [minMin, setMinMin] = useState(2);
  const [maxMin, setMaxMin] = useState(10);
  const [crossEngage, setCrossEngage] = useState(false);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [engagerIds, setEngagerIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");

  function applySpeed(s: typeof SPEEDS[number]) {
    setSpeed(s.key);
    if (s.instant) {
      setInstant(true);
    } else {
      setInstant(false);
      if (s.min != null) setMinMin(s.min);
      if (s.max != null) setMaxMin(s.max);
    }
  }

  function updateBlock(id: string, patch: Partial<Block>) {
    setBlocks((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function addBlock() {
    setBlocks((b) => [...b, { id: uid(), tweet_url: "", account_ids: [] }]);
  }
  function removeBlock(id: string) {
    setBlocks((b) => b.filter((x) => x.id !== id));
  }
  function toggleAcc(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function handleRun() {
    const cleanBlocks = blocks
      .map((b) => ({ tweet_url: b.tweet_url.trim(), account_ids: b.account_ids }))
      .filter((b) => b.tweet_url && b.account_ids.length);

    if (!cleanBlocks.length && !(crossEngage && sourceIds.length && engagerIds.length)) {
      toast.error("Adicione ao menos um bloco com URL+contas ou ative engajamento entre contas.");
      return;
    }
    const actions: Array<"like" | "retweet" | "comment"> = [];
    if (doLike) actions.push("like");
    if (doRetweet) actions.push("retweet");
    if (doComment) actions.push("comment");
    if (!actions.length) {
      toast.error("Escolha pelo menos uma ação (Like, RT ou Comentar).");
      return;
    }
    if (doComment && !commentText.trim()) {
      toast.error("Escreva o texto do comentário ou desmarque a ação Comentar.");
      return;
    }

    setRunning(true);
    setProgress(10);
    setProgressLabel("Validando contas e alvos...");
    try {
      setProgress(35);
      setProgressLabel("Buscando últimos tweets das contas...");
      const res = await run({
        data: {
          blocks: cleanBlocks,
          source_account_ids: crossEngage ? sourceIds : [],
          engager_account_ids: crossEngage ? engagerIds : [],
          actions,
          comment_text: commentText,
          instant,
          min_minutes: minMin,
          max_minutes: maxMin,
        },
      });
      setProgress(100);
      const word = instant ? "executando agora" : "agendada(s)";
      setProgressLabel(`${res.tasks} tarefa(s) ${word} em ${res.accounts} conta(s)`);
      toast.success(
        instant
          ? `Disparo instantâneo! ${res.tasks} ação(ões) sendo executada(s) agora em ${res.accounts} conta(s).`
          : `Disparado! ${res.tasks} tarefa(s) agendada(s) em ${res.accounts} conta(s).`,
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao disparar");
      setProgressLabel("Falhou");
    } finally {
      setTimeout(() => {
        setRunning(false);
        setProgress(0);
        setProgressLabel("");
      }, 2500);
    }
  }

  const ACTIONS = [
    { key: "rt", on: doRetweet, set: setDoRetweet, label: "Retweet", icon: Repeat2 },
    { key: "like", on: doLike, set: setDoLike, label: "Like", icon: Heart },
    { key: "comment", on: doComment, set: setDoComment, label: "Comentar", icon: MessageCircle },
  ];

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Operação"
        title="RT & Like em massa"
        description="Dispare retweets e curtidas humanizados entre todas as contas conectadas. Os fluxos normais (postagem, comentários) continuam rodando em paralelo."
      />

      <div className="mt-8 space-y-4">
        {/* Ações */}
        <Section icon={Rocket} title="Ações">
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => a.set(!a.on)}
                className={cn(
                  "inline-flex items-center gap-2 px-3.5 py-2 text-sm rounded-xl border transition-colors",
                  a.on
                    ? "gradient-brand text-white border-transparent"
                    : "border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20",
                )}
              >
                <a.icon className="h-4 w-4" /> {a.label}
              </button>
            ))}
          </div>

          {doComment && (
            <div className="space-y-1.5 mt-3">
              <Label className="text-xs text-muted-foreground">Texto do comentário</Label>
              <Textarea
                rows={3}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Escreva o comentário… Suporta variações: {muito bom|top|excelente} e variantes separadas por |||"
                className="bg-white/[0.04] border-white/10 focus-visible:border-brand/40"
              />
              <p className="text-xs text-muted-foreground">
                Cada conta comenta este texto no link. Use <code className="text-foreground">{`{a|b}`}</code> ou{" "}
                <code className="text-foreground">|||</code> para variar e evitar duplicidade.
              </p>
            </div>
          )}
        </Section>

        {/* Ritmo de envio */}
        <Section icon={Gauge} title="Ritmo de envio">
          <div className="flex flex-wrap gap-2">
            {SPEEDS.map((s) => {
              const active = speed === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => applySpeed(s)}
                  className={cn(
                    "flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-left transition-colors",
                    active
                      ? "gradient-brand text-white border-transparent"
                      : "border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20",
                  )}
                >
                  <s.icon className="h-4 w-4 shrink-0" />
                  <span className="leading-tight">
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className={cn("block text-[11px]", active ? "text-white/80" : "text-muted-foreground")}>{s.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {instant ? (
            <p className="mt-3 text-xs text-amber-400">
              ⚠️ Rajada sem intervalo aumenta o risco de bloqueio do X (erro 226). Use com proxies residenciais e poucas ações. Bloqueios temporários são re-tentados automaticamente.
            </p>
          ) : (
            <div className="mt-3">
              <div className="grid grid-cols-2 gap-4 max-w-sm">
                <div>
                  <Label className="text-xs text-muted-foreground">Intervalo mín (min)</Label>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={minMin}
                    onChange={(e) => { setMinMin(Number(e.target.value)); setSpeed("custom"); }}
                    className="bg-white/[0.04] border-white/10 focus-visible:border-brand/40 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Intervalo máx (min)</Label>
                  <Input
                    type="number"
                    min={1}
                    step={0.5}
                    value={maxMin}
                    onChange={(e) => { setMaxMin(Number(e.target.value)); setSpeed("custom"); }}
                    className="bg-white/[0.04] border-white/10 focus-visible:border-brand/40 mt-1"
                  />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Cada conta age uma vez, com tempo aleatório entre <b className="text-foreground">{minMin}</b> e{" "}
                <b className="text-foreground">{Math.max(minMin, maxMin)} min</b> — o robô dispara sozinho em background, sem rajada.
              </p>
            </div>
          )}
        </Section>

        {/* Disponibilidade: Disponíveis vs Em refresh */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="liquid-glass rounded-2xl p-5">
            <div className="relative flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/15 border border-emerald-400/20 text-emerald-400">
                <Users2 className="h-3.5 w-3.5" />
              </span>
              <h2 className="text-sm font-medium text-foreground">Contas disponíveis</h2>
              <span className="grid h-5 min-w-[20px] px-1.5 place-items-center rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-semibold tabular-nums">
                {activeAccounts.length}
              </span>
            </div>
            <p className="relative mt-2.5 text-xs text-muted-foreground leading-relaxed">
              Cada conta pode fazer <b className="text-foreground">3 RT + 3 like</b>; ao completar a cota
              ela entra em refresh de 1h automaticamente. Só estas aparecem para selecionar abaixo.
            </p>
          </div>

          <div className="liquid-glass rounded-2xl p-5">
            <div className="relative flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-500/15 border border-amber-400/20 text-amber-400">
                <Timer className="h-3.5 w-3.5" />
              </span>
              <h2 className="text-sm font-medium text-foreground">Em refresh</h2>
              <span className="grid h-5 min-w-[20px] px-1.5 place-items-center rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-semibold tabular-nums">
                {coolingAccounts.length}
              </span>
            </div>
            {coolingAccounts.length === 0 ? (
              <p className="relative mt-2.5 text-xs text-muted-foreground">Nenhuma conta em refresh agora.</p>
            ) : (
              <div className="relative mt-3 grid grid-cols-2 gap-1.5 max-h-32 overflow-y-auto">
                {coolingAccounts.map((a) => {
                  const mins = Math.max(1, Math.ceil((Date.parse(a.cooldown_until!) - Date.now()) / 60000));
                  return (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 opacity-80"
                    >
                      <span className="text-xs text-muted-foreground truncate">@{a.username}</span>
                      <span className="text-[10px] text-amber-300 tabular-nums whitespace-nowrap">{mins}min</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Blocos manuais */}
        <Section
          icon={LinkIcon}
          title="Blocos: link + contas designadas"
          action={
            <Button size="sm" variant="outline" onClick={addBlock} className="border-white/15">
              <Plus className="h-4 w-4 mr-1" /> Adicionar bloco
            </Button>
          }
        >
          {isLoading && <p className="text-sm text-muted-foreground">Carregando contas...</p>}

          <div className="space-y-3">
            {blocks.map((block, i) => (
              <div key={block.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Bloco #{i + 1} — {block.account_ids.length} conta(s)
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeBlock(block.id)}
                    disabled={blocks.length === 1}
                    className="h-7 w-7"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Input
                  placeholder="https://x.com/usuario/status/123..."
                  value={block.tweet_url}
                  onChange={(e) => updateBlock(block.id, { tweet_url: e.target.value })}
                  className="bg-white/[0.04] border-white/10 focus-visible:border-brand/40"
                />
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs text-muted-foreground">Contas que vão engajar neste link</Label>
                    <button
                      className="text-xs text-brand hover:underline"
                      onClick={() =>
                        updateBlock(block.id, {
                          account_ids:
                            block.account_ids.length === activeAccounts.length
                              ? []
                              : activeAccounts.map((a) => a.id),
                        })
                      }
                    >
                      {block.account_ids.length === activeAccounts.length ? "Limpar" : "Selecionar todas"}
                    </button>
                  </div>
                  <div className="max-h-40 overflow-auto rounded-lg border border-white/[0.08] bg-white/[0.02] p-2 grid grid-cols-2 sm:grid-cols-3 gap-1">
                    {activeAccounts.map((a) => (
                      <label
                        key={a.id}
                        className="flex items-center gap-2 text-sm px-2 py-1 rounded-md hover:bg-white/[0.05] cursor-pointer"
                      >
                        <Checkbox
                          checked={block.account_ids.includes(a.id)}
                          onCheckedChange={() =>
                            updateBlock(block.id, { account_ids: toggleAcc(block.account_ids, a.id) })
                          }
                        />
                        <span className="truncate">@{a.username}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Engajamento entre contas */}
        <Section icon={Users2} title="Engajar entre as próprias contas">
          <label className="flex items-center gap-2 cursor-pointer w-fit">
            <Checkbox checked={crossEngage} onCheckedChange={(v) => setCrossEngage(!!v)} />
            <span className="text-sm text-foreground">Ativar engajamento cruzado</span>
          </label>
          <p className="text-xs text-muted-foreground mt-2">
            O sistema pega o <b className="text-foreground">último tweet</b> de cada conta-fonte e agenda RT/like
            das contas engajadoras nesse tweet.
          </p>

          {crossEngage && (
            <div className="grid md:grid-cols-2 gap-4 mt-3">
              <AccountPicker
                title="Contas-fonte (autores dos posts)"
                accounts={activeAccounts}
                selected={sourceIds}
                onChange={setSourceIds}
              />
              <AccountPicker
                title="Contas que vão engajar"
                accounts={activeAccounts}
                selected={engagerIds}
                onChange={setEngagerIds}
              />
            </div>
          )}
        </Section>

        {running && (
          <div className="liquid-glass rounded-2xl p-4 space-y-2">
            <p className="relative text-sm text-foreground">{progressLabel}</p>
            <Progress value={progress} />
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button
            size="lg"
            onClick={handleRun}
            disabled={running}
            className="gradient-brand text-white border-0 glow-brand"
          >
            <Rocket className="h-4 w-4 mr-2" />
            {running ? "Disparando..." : "Disparar RT & Like em massa"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: any;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="liquid-glass rounded-2xl p-5">
      <div className="relative flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06] border border-white/10 text-brand">
            <Icon className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
        </div>
        {action}
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

function AccountPicker({
  title,
  accounts,
  selected,
  onChange,
}: {
  title: string;
  accounts: Account[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="flex items-center justify-between mb-2">
        <Label className="text-xs text-muted-foreground">{title}</Label>
        <button
          className="text-xs text-brand hover:underline"
          onClick={() => onChange(selected.length === accounts.length ? [] : accounts.map((a) => a.id))}
        >
          {selected.length === accounts.length ? "Limpar" : "Todas"}
        </button>
      </div>
      <div className="max-h-56 overflow-auto grid grid-cols-2 gap-1">
        {accounts.map((a) => (
          <label
            key={a.id}
            className="flex items-center gap-2 text-sm px-2 py-1 rounded-md hover:bg-white/[0.05] cursor-pointer"
          >
            <Checkbox
              checked={selected.includes(a.id)}
              onCheckedChange={() =>
                onChange(
                  selected.includes(a.id)
                    ? selected.filter((x) => x !== a.id)
                    : [...selected, a.id],
                )
              }
            />
            <span className="truncate">@{a.username}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-1">{selected.length} selecionada(s)</p>
    </div>
  );
}
