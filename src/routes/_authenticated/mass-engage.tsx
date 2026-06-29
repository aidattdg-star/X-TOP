import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, Trash2, Rocket, Heart, Repeat2, Link as LinkIcon, Users2, MessageCircle, Zap, Timer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { runMassEngage } from "@/lib/mass-engage.functions";

export const Route = createFileRoute("/_authenticated/mass-engage")({
  component: MassEnagePage,
});

type Account = { id: string; username: string; status: string | null; cooldown_until?: string | null };
type Block = { id: string; tweet_url: string; account_ids: string[] };

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

  // Disponíveis = não banidas e fora do refresh. Só essas podem ser selecionadas.
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.status !== "banned" && !isCooling(a)),
    [accounts],
  );
  // Em refresh (cooldown pós-RT/Like) — não selecionáveis.
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
  const [minMin, setMinMin] = useState(2);
  const [maxMin, setMaxMin] = useState(10);
  const [crossEngage, setCrossEngage] = useState(false);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [engagerIds, setEngagerIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");

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

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Rocket className="h-6 w-6" /> RT & Like em massa
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dispare retweets e curtidas humanizados entre todas as contas conectadas.
          Os fluxos normais (postagem, comentários) continuam rodando em paralelo.
        </p>
      </header>

      {/* Ações */}
      <section className="border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-medium">Ações</h2>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={doRetweet} onCheckedChange={(v) => setDoRetweet(!!v)} />
            <Repeat2 className="h-4 w-4" /> Retweet
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={doLike} onCheckedChange={(v) => setDoLike(!!v)} />
            <Heart className="h-4 w-4" /> Like
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={doComment} onCheckedChange={(v) => setDoComment(!!v)} />
            <MessageCircle className="h-4 w-4" /> Comentar
          </label>
        </div>

        {doComment && (
          <div className="space-y-1.5">
            <Label className="text-xs">Texto do comentário</Label>
            <Textarea
              rows={3}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Escreva o comentário… Suporta variações: {muito bom|top|excelente} e variantes separadas por |||"
            />
            <p className="text-xs text-muted-foreground">
              Cada conta comenta este texto no link. Use <code className="text-foreground">{`{a|b}`}</code> ou{" "}
              <code className="text-foreground">|||</code> para variar e evitar duplicidade.
            </p>
          </div>
        )}

        <label className="flex items-center gap-2 cursor-pointer w-fit rounded-lg border border-border bg-muted/30 px-3 py-2">
          <Checkbox checked={instant} onCheckedChange={(v) => setInstant(!!v)} />
          <Zap className="h-4 w-4 text-brand" />
          <span className="text-sm font-medium">Instantâneo</span>
          <span className="text-xs text-muted-foreground">— dá RT/Like na hora, sem delays</span>
        </label>
        {instant && (
          <p className="text-xs text-amber-400">
            ⚠️ Rajada sem intervalo aumenta o risco de bloqueio do X (erro 226). Use com proxies residenciais e poucas ações. Bloqueios temporários são re-tentados automaticamente.
          </p>
        )}

        {!instant && (
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div>
              <Label className="text-xs">Intervalo mín (min)</Label>
              <Input
                type="number"
                min={0.5}
                step={0.5}
                value={minMin}
                onChange={(e) => setMinMin(Number(e.target.value))}
              />
            </div>
            <div>
              <Label className="text-xs">Intervalo máx (min)</Label>
              <Input
                type="number"
                min={1}
                step={0.5}
                value={maxMin}
                onChange={(e) => setMaxMin(Number(e.target.value))}
              />
            </div>
          </div>
        )}
      </section>

      {/* Contas em refresh (cooldown pós-RT/Like) — não selecionáveis */}
      {coolingAccounts.length > 0 && (
        <section className="border border-amber-500/20 bg-amber-500/[0.04] rounded-lg p-5">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Timer className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-medium">Contas em refresh</h2>
            <span className="grid h-5 min-w-[20px] px-1.5 place-items-center rounded-full bg-amber-500/20 text-amber-300 text-[11px] font-semibold tabular-nums">
              {coolingAccounts.length}
            </span>
            <span className="text-xs text-muted-foreground">
              descansando 1h após RT/Like — não dá pra selecionar até liberar
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 max-h-44 overflow-y-auto">
            {coolingAccounts.map((a) => {
              const mins = Math.max(1, Math.ceil((Date.parse(a.cooldown_until!) - Date.now()) / 60000));
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 opacity-70"
                >
                  <span className="text-xs text-muted-foreground truncate">@{a.username}</span>
                  <span className="text-[10px] text-amber-300 tabular-nums whitespace-nowrap">{mins}min</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Blocos manuais */}
      <section className="border rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <LinkIcon className="h-4 w-4" /> Blocos: link + contas designadas
          </h2>
          <Button size="sm" variant="outline" onClick={addBlock}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar bloco
          </Button>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Carregando contas...</p>}

        {blocks.map((block, i) => (
          <div key={block.id} className="border rounded-md p-4 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase text-muted-foreground">
                Bloco #{i + 1} — {block.account_ids.length} conta(s)
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeBlock(block.id)}
                disabled={blocks.length === 1}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Input
              placeholder="https://x.com/usuario/status/123..."
              value={block.tweet_url}
              onChange={(e) => updateBlock(block.id, { tweet_url: e.target.value })}
            />
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">Contas que vão engajar neste link</Label>
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    updateBlock(block.id, {
                      account_ids:
                        block.account_ids.length === activeAccounts.length
                          ? []
                          : activeAccounts.map((a) => a.id),
                    })
                  }
                >
                  {block.account_ids.length === activeAccounts.length
                    ? "Limpar"
                    : "Selecionar todas"}
                </button>
              </div>
              <div className="max-h-40 overflow-auto border rounded p-2 grid grid-cols-2 sm:grid-cols-3 gap-1">
                {activeAccounts.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-accent cursor-pointer"
                  >
                    <Checkbox
                      checked={block.account_ids.includes(a.id)}
                      onCheckedChange={() =>
                        updateBlock(block.id, {
                          account_ids: toggleAcc(block.account_ids, a.id),
                        })
                      }
                    />
                    <span className="truncate">@{a.username}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Engajamento entre contas */}
      <section className="border rounded-lg p-5 space-y-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={crossEngage} onCheckedChange={(v) => setCrossEngage(!!v)} />
          <Users2 className="h-4 w-4" />
          <span className="text-sm font-medium">Engajar entre as próprias contas</span>
        </label>
        <p className="text-xs text-muted-foreground">
          O sistema pega o <b>último tweet</b> de cada conta-fonte e agenda RT/like
          das contas engajadoras nesse tweet.
        </p>

        {crossEngage && (
          <div className="grid md:grid-cols-2 gap-4">
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
      </section>

      {running && (
        <div className="border rounded-lg p-4 space-y-2 bg-muted/30">
          <p className="text-sm">{progressLabel}</p>
          <Progress value={progress} />
        </div>
      )}

      <div className="flex justify-end">
        <Button size="lg" onClick={handleRun} disabled={running}>
          <Rocket className="h-4 w-4 mr-2" />
          {running ? "Disparando..." : "Disparar RT & Like em massa"}
        </Button>
      </div>
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
    <div className="border rounded-md p-3">
      <div className="flex items-center justify-between mb-2">
        <Label className="text-xs">{title}</Label>
        <button
          className="text-xs text-primary hover:underline"
          onClick={() =>
            onChange(selected.length === accounts.length ? [] : accounts.map((a) => a.id))
          }
        >
          {selected.length === accounts.length ? "Limpar" : "Todas"}
        </button>
      </div>
      <div className="max-h-56 overflow-auto grid grid-cols-2 gap-1">
        {accounts.map((a) => (
          <label
            key={a.id}
            className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-accent cursor-pointer"
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
