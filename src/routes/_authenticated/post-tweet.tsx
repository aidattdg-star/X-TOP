import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { postTweetToAccounts } from "@/lib/account-profile.functions";
import { Send, Image as ImageIcon, Search, Check, Loader2, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/post-tweet")({
  component: PostTweetPage,
});

type Account = { id: string; username: string; status: string | null; profile_picture_url: string | null; folder_id: string | null };
type Folder = { id: string; name: string };
type MediaFolder = { id: string; name: string };
type MediaFile = { id: string; storage_path: string; signed_url: string | null; original_filename: string };

function PostTweetPage() {
  const runPost = useServerFn(postTweetToAccounts);

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
    if (mediaMode === "same" && !mediaFileId) return toast.error("Escolha a imagem.");

    setBusy(true);
    setProgress({ done: 0, total: selected.length, ok: 0 });
    let ok = 0;
    const fails: string[] = [];
    try {
      for (let i = 0; i < selected.length; i++) {
        try {
          const res = await runPost({
            data: {
              accountIds: [selected[i]],
              text: text.trim(),
              mode: mediaMode === "none" ? undefined : mediaMode,
              folderId: mediaMode !== "none" ? mediaFolderId : undefined,
              mediaFileId: mediaMode === "same" ? mediaFileId : undefined,
            },
          });
          if (res.results[0]?.ok) ok++;
          else fails.push(res.results[0]?.error ?? "falha");
        } catch (e) {
          fails.push(e instanceof Error ? e.message : "falha");
        }
        setProgress({ done: i + 1, total: selected.length, ok });
      }
      if (fails.length === 0) toast.success(`Postado em ${ok} conta(s) ✓`);
      else toast.warning(`${ok} ok / ${fails.length} falha(s): ${fails[0]?.slice(0, 100)}`);
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
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              {!mediaFolders.length && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Crie pastas em Mídias → categoria "Mídias para tweets" (ex.: modelo 1, 2, 3).
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

        {/* Disparo */}
        <div className="flex items-center gap-3">
          <button
            onClick={dispatch}
            disabled={busy}
            className="px-5 py-2.5 text-sm font-medium rounded-xl gradient-brand text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2 transition-opacity"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Postar em {selected.length || ""} conta(s)
          </button>
          {busy && (
            <div className="flex-1 max-w-xs">
              <Progress value={progress.total ? Math.round((progress.done / progress.total) * 100) : 0} className="h-1.5" />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {progress.done}/{progress.total} · {progress.ok} ok
              </p>
            </div>
          )}
        </div>
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
