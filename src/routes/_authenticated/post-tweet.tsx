import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { postTweetToAccounts, schedulePostTweet, scheduleImageCampaign } from "@/lib/account-profile.functions";
import { Send, Image as ImageIcon, Search, Check, Loader2, Users, Dice5, CheckCircle2, XCircle, ExternalLink, CalendarClock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/post-tweet")({
  component: PostTweetPage,
});

type Account = { id: string; username: string; status: string | null; profile_picture_url: string | null; folder_id: string | null };
type Folder = { id: string; name: string };
type MediaFolder = { id: string; name: string };
type MediaFile = { id: string; storage_path: string; signed_url: string | null; original_filename: string };

type PostResult = { username?: string; ok: boolean; url?: string; error?: string };

function PostTweetPage() {
  const runPost = useServerFn(postTweetToAccounts);
  const runSchedule = useServerFn(schedulePostTweet);
  const runCampaign = useServerFn(scheduleImageCampaign);

  const [ritmo, setRitmo] = useState<"now" | "human" | "campaign">("now");
  const [minMin, setMinMin] = useState(2);
  const [maxMin, setMaxMin] = useState(10);
  const [days, setDays] = useState(3);
  const [cycles, setCycles] = useState(1);
  const [results, setResults] = useState<PostResult[]>([]);
  const [scheduledMsg, setScheduledMsg] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [acctFilter, setAcctFilter] = useState("");
  const [folderTab, setFolderTab] = useState<string>("__all__");
  const [mediaFolderId, setMediaFolderId] = useState("");
  const [mediaMode, setMediaMode] = useState<"none" | "random" | "same">("none");
  const [mediaFileId, setMediaFileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, ok: 0 });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ["post-accounts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("twitter_accounts")
        .select("id, username, status, profile_picture_url, folder_id")
        .neq("status", "banned")
        .order("username");
      return (data ?? []) as Account[];
    },
  });

  const { data: accFolders = [] } = useQuery<Folder[]>({
    queryKey: ["account_folders"],
    queryFn: async () => {
      const { data } = await supabase.from("account_folders").select("id, name").order("name");
      return (data ?? []) as Folder[];
    },
  });

  const { data: mediaFolders = [] } = useQuery<MediaFolder[]>({
    queryKey: ["media_folders_tweet"],
    queryFn: async () => {
      const { data } = await supabase
        .from("media_folders")
        .select("id, name, category")
        .eq("category", "tweet_media")
        .order("name");
      return (data ?? []) as MediaFolder[];
    },
  });

  const { data: mediaCounts } = useQuery<Record<string, number>>({
    queryKey: ["media_file_counts"],
    queryFn: async () => {
      const { data } = await supabase.from("media_files").select("folder_id");
      const c: Record<string, number> = {};
      for (const r of data ?? []) {
        const fid = (r as any).folder_id as string;
        c[fid] = (c[fid] ?? 0) + 1;
      }
      return c;
    },
  });
  const mediaFolderCount = mediaFolderId ? (mediaCounts?.[mediaFolderId] ?? 0) : null;

  const { data: files = [] } = useQuery<MediaFile[]>({
    queryKey: ["media_files_post", mediaFolderId],
    enabled: !!mediaFolderId && mediaMode === "same",
    queryFn: async () => {
      const { data } = await supabase
        .from("media_files")
        .select("id, storage_path, original_filename")
        .eq("folder_id", mediaFolderId)
        .order("created_at", { ascending: false });
      return Promise.all(
        (data ?? []).map(async (f) => {
          const { data: signed } = await supabase.storage.from("media").createSignedUrl(f.storage_path, 3600);
          return { ...f, signed_url: signed?.signedUrl ?? null } as MediaFile;
        }),
      );
    },
  });

  const shown = useMemo(() => {
    const q = acctFilter.trim().toLowerCase();
    return accounts.filter((a) => {
      if (folderTab === "__none__" ? a.folder_id : folderTab !== "__all__" && a.folder_id !== folderTab) return false;
      return !q || a.username.toLowerCase().includes(q);
    });
  }, [accounts, acctFilter, folderTab]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allShownOn = shown.length > 0 && shown.every((a) => selected.includes(a.id));
  const toggleAllShown = () =>
    setSelected((s) =>
      allShownOn ? s.filter((id) => !shown.some((a) => a.id === id)) : [...new Set([...s, ...shown.map((a) => a.id)])],
    );

  async function dispatch() {
    if (!selected.length) return toast.error("Selecione ao menos uma conta.");
    if (!text.trim() && mediaMode === "none") return toast.error("Escreva o texto ou escolha uma mídia.");
    if (mediaMode !== "none" && !mediaFolderId) return toast.error("Escolha a pasta de mídia.");
    if (mediaMode !== "none" && mediaFolderCount === 0) return toast.error("Pasta de mídia vazia — envie imagens primeiro.");
    if (mediaMode === "same" && !mediaFileId) return toast.error("Escolha a imagem.");

    setBusy(true);
    setResults([]);
    setScheduledMsg(null);

    const common = {
      text: text.trim(),
      mode: mediaMode === "none" ? undefined : (mediaMode as "same" | "random"),
      folderId: mediaMode !== "none" ? mediaFolderId : undefined,
      mediaFileId: mediaMode === "same" ? mediaFileId : undefined,
    };

    // CAMPANHA: distribui as imagens da pasta em N dias, sem repetir (loop opcional)
    if (ritmo === "campaign") {
      if (mediaMode !== "random" || !mediaFolderId) {
        setBusy(false);
        return toast.error('Na campanha, escolha "Aleatória da pasta" e uma pasta com imagens.');
      }
      try {
        const r = await runCampaign({
          data: { accountIds: selected, text: text.trim(), folderId: mediaFolderId, days, cycles },
        });
        setScheduledMsg(
          `Campanha criada: ${r.images} imagem(ns) distribuída(s) em ${r.days} dia(s)${r.cycles > 1 ? ` × ${r.cycles} ciclos` : ""}, sem repetir, por conta. ${r.tasks} post(s) agendado(s). O robô publica sozinho — acompanhe em Logs.`,
        );
        toast.success(`Campanha agendada: ${r.tasks} post(s)`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao agendar campanha");
      } finally {
        setBusy(false);
      }
      return;
    }

    // MODO HUMANIZADO: agenda na fila e o worker posta em background
    if (ritmo === "human") {
      try {
        const r = await runSchedule({
          data: { accountIds: selected, ...common, minMinutes: minMin, maxMinutes: Math.max(minMin, maxMin) },
        });
        setScheduledMsg(
          `${r.tasks} post(s) agendado(s) — o robô vai publicando em background, com intervalo aleatório de ${minMin}–${Math.max(minMin, maxMin)} min entre cada. Acompanhe em Logs.`,
        );
        toast.success(`${r.tasks} post(s) agendado(s) (humanizado)`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao agendar");
      } finally {
        setBusy(false);
      }
      return;
    }

    // MODO IMEDIATO: posta agora, conta por conta, com log do resultado
    setProgress({ done: 0, total: selected.length, ok: 0 });
    let ok = 0;
    const acc = new Map(accounts.map((a) => [a.id, a.username]));
    const collected: PostResult[] = [];
    try {
      for (let i = 0; i < selected.length; i++) {
        try {
          const res = await runPost({ data: { accountIds: [selected[i]], ...common } });
          const r = res.results[0];
          collected.push({ username: acc.get(selected[i]), ok: !!r?.ok, url: r?.url, error: r?.error });
          if (r?.ok) ok++;
        } catch (e) {
          collected.push({ username: acc.get(selected[i]), ok: false, error: e instanceof Error ? e.message : "falha" });
        }
        setResults([...collected]);
        setProgress({ done: i + 1, total: selected.length, ok });
      }
      const fails = collected.length - ok;
      if (fails === 0) toast.success(`Postado em ${ok} conta(s) ✓`);
      else toast.warning(`${ok} ok / ${fails} falha(s) — veja o log abaixo`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Operação"
        title="Postar tweet"
        description="Publique um tweet (texto + mídia da biblioteca) em várias contas de uma vez."
      />

      <div className="mt-8 space-y-4">
        {/* Texto */}
        <div className="liquid-glass rounded-2xl p-5">
          <p className="relative text-xs uppercase tracking-wider text-muted-foreground mb-2">Tweet / legenda</p>
          <textarea
            rows={4}
            value={text}
            maxLength={280}
            onChange={(e) => setText(e.target.value)}
            placeholder="O que está acontecendo? Variações com {a|b} e ||| pra evitar duplicidade."
            className="relative w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-lg text-sm outline-none focus:border-brand/40 transition-colors resize-none"
          />
          <p className="relative mt-1 text-[10px] text-muted-foreground">{text.length}/280</p>
        </div>

        {/* Mídia */}
        <div className="liquid-glass rounded-2xl p-5 space-y-3">
          <div className="relative flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06] border border-white/10 text-brand">
              <ImageIcon className="h-3.5 w-3.5" />
            </span>
            <p className="text-sm font-medium text-foreground">Mídia (opcional)</p>
          </div>
          <div className="relative flex flex-wrap gap-2">
            {(["none", "random", "same"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMediaMode(m)}
                className={cn(
                  "px-3 py-2 text-xs rounded-lg border transition-colors",
                  mediaMode === m ? "gradient-brand text-white border-transparent" : "border-white/10 text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "none" ? "Sem mídia" : m === "random" ? "Aleatória da pasta" : "Mesma imagem"}
              </button>
            ))}
          </div>

          {mediaMode !== "none" && (
            <div className="relative">
              <p className="text-xs text-muted-foreground mb-1">Pasta da biblioteca (mídias para tweets)</p>
              <select
                value={mediaFolderId}
                onChange={(e) => { setMediaFolderId(e.target.value); setMediaFileId(""); }}
                className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-lg text-sm outline-none focus:border-brand/40"
              >
                <option value="">Selecione…</option>
                {mediaFolders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({mediaCounts?.[f.id] ?? 0})
                  </option>
                ))}
              </select>
              {!mediaFolders.length && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Crie pastas em Mídias → categoria "Mídias para tweets" (ex.: modelo 1, 2, 3).
                </p>
              )}
              {mediaFolderCount === 0 && (
                <p className="mt-1 text-[10px] text-amber-400">
                  ⚠ Pasta vazia — envie imagens nessa pasta em Mídias.
                </p>
              )}
            </div>
          )}

          {mediaMode === "same" && mediaFolderId && (
            <div className="relative grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-44 overflow-y-auto">
              {files.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setMediaFileId(f.id)}
                  className={cn(
                    "aspect-square rounded-lg overflow-hidden border-2 transition-colors",
                    mediaFileId === f.id ? "border-brand" : "border-transparent hover:border-white/20",
                  )}
                >
                  {f.signed_url ? (
                    <img src={f.signed_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-white/[0.06]" />
                  )}
                </button>
              ))}
              {!files.length && <p className="col-span-full text-xs text-muted-foreground p-2">Pasta vazia.</p>}
            </div>
          )}
        </div>

        {/* Contas */}
        <div className="liquid-glass rounded-2xl p-5 space-y-3">
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06] border border-white/10 text-brand">
                <Users className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm font-medium text-foreground">Contas que vão postar</p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              <b className="text-foreground tabular-nums">{selected.length}</b> selecionada(s)
            </span>
          </div>

          {/* pills de pasta */}
          <div className="relative flex flex-wrap gap-1.5">
            <Pill label="Todas" active={folderTab === "__all__"} onClick={() => setFolderTab("__all__")} />
            <Pill label="Sem pasta" active={folderTab === "__none__"} onClick={() => setFolderTab("__none__")} />
            {accFolders.map((f) => (
              <Pill key={f.id} label={f.name} active={folderTab === f.id} onClick={() => setFolderTab(f.id)} />
            ))}
          </div>

          <div className="relative rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-2 border-b border-white/[0.06]">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                value={acctFilter}
                onChange={(e) => setAcctFilter(e.target.value)}
                placeholder="Buscar @conta…"
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              />
              <button type="button" onClick={toggleAllShown} className="text-[11px] text-brand hover:underline shrink-0">
                {allShownOn ? "Limpar" : "Todas"}
              </button>
            </div>
            <div className="max-h-56 overflow-auto p-1.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0.5">
              {shown.map((a) => {
                const on = selected.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggle(a.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                      on ? "bg-accent" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", on ? "border-brand bg-brand text-white" : "border-white/15")}>
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    {a.profile_picture_url ? (
                      <img src={a.profile_picture_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-white/[0.06]" />
                    )}
                    <span className="text-xs text-foreground truncate">@{a.username}</span>
                  </button>
                );
              })}
              {shown.length === 0 && (
                <p className="col-span-full px-2 py-4 text-center text-[11px] text-muted-foreground">Nenhuma conta.</p>
              )}
            </div>
          </div>
        </div>

        {/* Modo de envio: imediato x humanizado */}
        <div className="liquid-glass rounded-2xl p-5 space-y-3">
          <div className="relative flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.06] border border-white/10 text-brand">
              <Dice5 className="h-3.5 w-3.5" />
            </span>
            <p className="text-sm font-medium text-foreground">Ritmo de envio</p>
          </div>
          <div className="relative flex flex-wrap gap-2">
            {([
              { k: "now", label: "Postar agora" },
              { k: "human", label: "Humanizado (intervalo)" },
              { k: "campaign", label: "Campanha (imagens em dias)" },
            ] as const).map((o) => (
              <button
                key={o.k}
                type="button"
                onClick={() => setRitmo(o.k)}
                className={cn("px-3 py-2 text-xs rounded-lg border transition-colors", ritmo === o.k ? "gradient-brand text-white border-transparent" : "border-white/10 text-muted-foreground hover:text-foreground")}
              >
                {o.label}
              </button>
            ))}
          </div>

          {ritmo === "human" && (
            <div className="relative space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">A cada</span>
                <input type="number" min={0.5} step={0.5} value={minMin}
                  onChange={(e) => setMinMin(Math.max(0.5, Number(e.target.value) || 0.5))}
                  className="h-9 w-16 text-center bg-white/[0.04] border border-white/10 rounded-lg text-sm outline-none focus:border-brand/40" />
                <span className="text-xs text-muted-foreground">a</span>
                <input type="number" min={0.5} step={0.5} value={maxMin}
                  onChange={(e) => setMaxMin(Math.max(0.5, Number(e.target.value) || 0.5))}
                  className="h-9 w-16 text-center bg-white/[0.04] border border-white/10 rounded-lg text-sm outline-none focus:border-brand/40" />
                <span className="text-xs text-muted-foreground">minutos</span>
              </div>
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
                <Dice5 className="h-3.5 w-3.5 text-brand shrink-0 mt-0.5" />
                <span>
                  Cada conta posta uma vez, com um tempo <b className="text-foreground">aleatório entre {minMin} e {Math.max(minMin, maxMin)} min</b> — o robô publica sozinho em background, sem burst.
                </span>
              </p>
            </div>
          )}

          {ritmo === "campaign" && (
            <div className="relative space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Distribuir as imagens da pasta em</span>
                <input type="number" min={0.25} step={0.25} value={days}
                  onChange={(e) => setDays(Math.max(0.25, Number(e.target.value) || 1))}
                  className="h-9 w-16 text-center bg-white/[0.04] border border-white/10 rounded-lg text-sm outline-none focus:border-brand/40" />
                <span className="text-xs text-muted-foreground">dia(s)</span>
                <span className="text-xs text-muted-foreground ml-2">· repetir (loop)</span>
                <input type="number" min={1} step={1} value={cycles}
                  onChange={(e) => setCycles(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="h-9 w-14 text-center bg-white/[0.04] border border-white/10 rounded-lg text-sm outline-none focus:border-brand/40" />
                <span className="text-xs text-muted-foreground">vez(es)</span>
              </div>
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
                <CalendarClock className="h-3.5 w-3.5 text-brand shrink-0 mt-0.5" />
                <span>
                  {mediaFolderCount != null && mediaFolderCount > 0 ? (
                    <>
                      <b className="text-foreground">{mediaFolderCount} imagem(ns)</b> da pasta serão postadas <b className="text-foreground">uma por post, sem repetir</b>, espalhadas em <b className="text-foreground">{days} dia(s)</b>
                      {cycles > 1 ? <> e repetidas <b className="text-foreground">{cycles}×</b></> : null}. Cada conta selecionada roda a campanha. Use o modo de mídia <b className="text-foreground">"Aleatória da pasta"</b> acima.
                    </>
                  ) : (
                    <>Escolha acima o modo <b className="text-foreground">"Aleatória da pasta"</b> e uma pasta <b className="text-foreground">com imagens</b>. Aí elas serão distribuídas em {days} dia(s), sem repetir.</>
                  )}
                </span>
              </p>
            </div>
          )}
        </div>

        {/* Disparo */}
        <div className="flex items-center gap-3">
          <button
            onClick={dispatch}
            disabled={busy}
            className="px-5 py-2.5 text-sm font-medium rounded-xl gradient-brand text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2 transition-opacity"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {ritmo === "now" ? "Postar" : "Agendar"} em {selected.length || ""} conta(s)
          </button>
          {busy && ritmo === "now" && (
            <div className="flex-1 max-w-xs">
              <Progress value={progress.total ? Math.round((progress.done / progress.total) * 100) : 0} className="h-1.5" />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {progress.done}/{progress.total} · {progress.ok} ok
              </p>
            </div>
          )}
        </div>

        {/* Agendado (humanizado) */}
        {scheduledMsg && (
          <div className="liquid-glass rounded-2xl p-4 flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <p className="relative text-xs text-muted-foreground leading-relaxed">{scheduledMsg}</p>
          </div>
        )}

        {/* Log de resultados (imediato) */}
        {results.length > 0 && (
          <div className="liquid-glass rounded-2xl overflow-hidden">
            <div className="relative px-5 py-3 border-b border-white/[0.06] flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Resultado</p>
              <p className="text-[11px] text-muted-foreground">
                <b className="text-emerald-400">{results.filter((r) => r.ok).length} ok</b> ·{" "}
                <b className="text-destructive">{results.filter((r) => !r.ok).length} falha(s)</b>
              </p>
            </div>
            <div className="relative max-h-72 overflow-auto divide-y divide-white/[0.05]">
              {results.map((r, i) => (
                <div key={i} className="px-5 py-2.5 flex items-center gap-2.5">
                  {r.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive shrink-0" />
                  )}
                  <span className="text-[13px] text-foreground truncate">@{r.username ?? "—"}</span>
                  {r.ok && r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[11px] text-brand hover:underline">
                      ver tweet <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="ml-auto text-[11px] text-destructive truncate max-w-[60%]" title={r.error}>{r.error?.slice(0, 80)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-[11px] font-medium border transition-colors",
        active ? "border-brand/50 bg-accent text-foreground" : "border-white/10 text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
