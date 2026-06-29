import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Image as ImageIcon, AlertTriangle, Loader2, ScrollText, CheckCircle2, XCircle, RefreshCw, Search, Check, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Progress } from "@/components/ui/progress";
import {
  applyAvatarToAccounts,
  applyBannerToAccounts,
  updateAccountsProfile,
  updateAccountUsername,
} from "@/lib/account-profile.functions";

export const Route = createFileRoute("/_authenticated/edit-accounts")({
  component: EditAccountsPage,
});

type Account = {
  id: string;
  username: string;
  display_name: string | null;
  profile_picture_url: string | null;
  status: string;
};

type Folder = { id: string; name: string; category: "profile_picture" | "tweet_media" };
type MediaFile = { id: string; storage_path: string; signed_url: string | null; original_filename: string };

function EditAccountsPage() {
  const qc = useQueryClient();

  const applyAvatarFn = useServerFn(applyAvatarToAccounts);
  const applyBannerFn = useServerFn(applyBannerToAccounts);
  const updateProfileFn = useServerFn(updateAccountsProfile);
  const updateUsernameFn = useServerFn(updateAccountUsername);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  const { data: accounts } = useQuery<Account[]>({
    queryKey: ["twitter_accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("twitter_accounts")
        .select("id, username, display_name, profile_picture_url, status")
        .order("username");
      if (error) throw error;
      return (data ?? []) as Account[];
    },
  });

  const { data: folders } = useQuery<Folder[]>({
    queryKey: ["media_folders"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return [];

      const { data, error } = await supabase
        .from("media_folders")
        .select("id, name, category")
        .order("category", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Folder[];
    },
  });

  const filtered = useMemo(() => {
    if (!accounts) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return accounts;
    return accounts.filter(
      (a) => a.username.toLowerCase().includes(f) || (a.display_name ?? "").toLowerCase().includes(f),
    );
  }, [accounts, filter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (!filtered.length) return;
    setSelected((prev) =>
      filtered.every((a) => prev.has(a.id))
        ? new Set([...prev].filter((id) => !filtered.find((a) => a.id === id)))
        : new Set([...prev, ...filtered.map((a) => a.id)]),
    );
  }

  const ids = Array.from(selected);
  const single = ids.length === 1 ? accounts?.find((a) => a.id === ids[0]) ?? null : null;

  const profileFolders = folders?.filter((f) => f.category === "profile_picture") ?? [];

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-10 max-w-7xl mx-auto">
      <PageHeader
        eyebrow="Operação"
        title="Editar contas"
        description="Atualize avatar, banner, nome, bio e @ username — individualmente ou em lote."
      />

      <div className="mt-10 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6">
        {/* SELETOR DE CONTAS */}
        <aside className="liquid-glass rounded-2xl overflow-hidden flex flex-col max-h-[75vh] lg:sticky lg:top-6">
          <div className="relative p-4 border-b border-white/[0.06] space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Contas selecionadas
              </p>
              <span className="grid h-6 min-w-[26px] px-2 place-items-center rounded-full bg-brand/15 text-brand text-xs font-semibold tabular-nums">
                {selected.size}
              </span>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrar @username…"
                className="w-full h-9 pl-9 pr-3 bg-white/[0.04] border border-white/10 rounded-lg text-xs outline-none focus:border-brand/40 transition-colors placeholder:text-muted-foreground"
              />
            </div>
            <button
              onClick={toggleAll}
              className="text-[11px] font-medium text-brand hover:underline"
            >
              {filtered.length && filtered.every((a) => selected.has(a.id))
                ? "Limpar seleção visível"
                : "Selecionar todas visíveis"}
            </button>
          </div>
          <div className="relative flex-1 overflow-y-auto p-2 space-y-0.5">
            {filtered.map((a) => {
              const on = selected.has(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggle(a.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-left transition-colors",
                    on ? "bg-accent" : "hover:bg-white/[0.04]",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition-colors",
                      on ? "border-brand bg-brand text-white" : "border-white/15",
                    )}
                  >
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  {a.profile_picture_url ? (
                    <img src={a.profile_picture_url} alt="" className="w-8 h-8 rounded-full object-cover ring-1 ring-white/10" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-white/[0.06] grid place-items-center text-[10px] font-medium text-muted-foreground uppercase">
                      {a.username.slice(0, 2)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-[13px] text-foreground leading-tight">@{a.username}</p>
                    <p className="truncate text-muted-foreground text-[11px] leading-tight">{a.display_name || "—"}</p>
                  </div>
                  <StatusDot status={a.status} />
                </button>
              );
            })}
            {!filtered.length && (
              <p className="text-xs text-muted-foreground p-6 text-center">Nenhuma conta encontrada.</p>
            )}
          </div>
        </aside>

        {/* PAINEL DE EDIÇÃO */}
        <section className="space-y-6">
          {!selected.size && (
            <div className="liquid-glass rounded-2xl p-12 grid place-items-center text-center min-h-[300px]">
              <div className="relative">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.06] border border-white/10 text-brand">
                  <UserCog className="h-7 w-7" strokeWidth={1.5} />
                </div>
                <p className="mt-4 text-sm text-foreground">Nenhuma conta selecionada</p>
                <p className="mt-1 text-xs text-muted-foreground max-w-xs">
                  Escolha 1 ou mais contas na lista à esquerda para editar avatar, banner, nome, bio ou @.
                </p>
              </div>
            </div>
          )}

          {selected.size > 0 && (
            <>
              <NameBioCard
                count={selected.size}
                accountIds={ids}
                onDone={() => qc.invalidateQueries({ queryKey: ["twitter_accounts"] })}
                runFn={updateProfileFn}
              />
              <MediaApplyCard
                title="Foto de perfil"
                kind="avatar"
                accountIds={ids}
                folders={profileFolders}
                runFn={applyAvatarFn}
                onDone={() => qc.invalidateQueries({ queryKey: ["twitter_accounts"] })}
              />
              <MediaApplyCard
                title="Banner / capa"
                kind="banner"
                accountIds={ids}
                folders={profileFolders}
                runFn={applyBannerFn}
                onDone={() => qc.invalidateQueries({ queryKey: ["twitter_accounts"] })}
              />
              <UsernameCard
                single={single}
                runFn={updateUsernameFn}
                onDone={() => qc.invalidateQueries({ queryKey: ["twitter_accounts"] })}
              />
              <LogPanel accountIds={ids} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ============================================================================
// NOME / BIO
// ============================================================================
function NameBioCard({
  count,
  accountIds,
  onDone,
  runFn,
}: {
  count: number;
  accountIds: string[];
  onDone: () => void;
  runFn: (args: { data: any }) => Promise<any>;
}) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, ok: 0, fail: 0 });

  async function submit() {
    if (!name.trim() && !bio.trim()) {
      toast.info("Preencha nome ou bio antes de aplicar");
      return;
    }
    setBusy(true);
    setProgress({ done: 0, ok: 0, fail: 0 });
    let ok = 0, fail = 0;
    try {
      for (let i = 0; i < accountIds.length; i++) {
        const payload: any = { accountIds: [accountIds[i]] };
        if (name.trim()) payload.name = name.trim();
        if (bio.trim()) payload.bio = bio.trim();
        try {
          const { results } = await runFn({ data: payload });
          if (results[0]?.ok) ok++; else fail++;
        } catch { fail++; }
        setProgress({ done: i + 1, ok, fail });
      }
      if (fail === 0) toast.success(`Atualizado em ${ok} conta(s)`);
      else toast.warning(`${ok} ok / ${fail} falha(s) — confira o log abaixo`);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Nome de exibição & bio" subtitle={`${count} conta(s) selecionada(s) receberão os mesmos valores`}>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground">Nome de exibição</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={50}
            placeholder="Deixe vazio para não alterar"
            className="w-full mt-1 px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-lg text-sm outline-none focus:border-brand/40 transition-colors"
          />
          <p className="text-[10px] text-muted-foreground mt-1">{name.length}/50</p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={160}
            rows={3}
            placeholder="Deixe vazio para não alterar"
            className="w-full mt-1 px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-lg text-sm outline-none focus:border-brand/40 transition-colors resize-none"
          />
          <p className="text-[10px] text-muted-foreground mt-1">{bio.length}/160</p>
        </div>
        <button
          onClick={submit}
          disabled={busy}
          className="px-4 py-2.5 text-xs font-medium rounded-lg gradient-brand text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2 transition-opacity"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          Aplicar nome/bio em {count} conta(s)
        </button>
        {busy && (
          <ProgressStrip done={progress.done} total={count} ok={progress.ok} fail={progress.fail} />
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// AVATAR / BANNER
// ============================================================================
function MediaApplyCard({
  title,
  kind,
  accountIds,
  folders,
  runFn,
  onDone,
}: {
  title: string;
  kind: "avatar" | "banner";
  accountIds: string[];
  folders: Folder[];
  runFn: (args: { data: any }) => Promise<any>;
  onDone: () => void;
}) {
  const [folderId, setFolderId] = useState<string>("");
  const [mode, setMode] = useState<"same" | "random">("random");
  const [mediaFileId, setMediaFileId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, ok: 0, fail: 0 });

  const { data: files } = useQuery<MediaFile[]>({
    queryKey: ["media_files", folderId],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session || !folderId) return [];

      const { data, error } = await supabase
        .from("media_files")
        .select("id, storage_path, original_filename")
        .eq("folder_id", folderId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      return Promise.all(
        (data ?? []).map(async (file) => {
          const { data: signed } = await supabase.storage
            .from("media")
            .createSignedUrl(file.storage_path, 3600);
          return { ...file, signed_url: signed?.signedUrl ?? null } as MediaFile;
        }),
      );
    },
    enabled: !!folderId,
  });

  // contagem de imagens por pasta (pra mostrar e evitar pasta vazia)
  const { data: folderCounts } = useQuery<Record<string, number>>({
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
  const selectedCount = folderId ? (folderCounts?.[folderId] ?? 0) : null;

  async function submit() {
    if (!folderId) { toast.error("Escolha uma pasta"); return; }
    if (selectedCount === 0) {
      toast.error("Pasta vazia — envie imagens em Mídias antes de aplicar.");
      return;
    }
    if (mode === "same" && !mediaFileId) { toast.error("Escolha a imagem"); return; }
    setBusy(true);
    setProgress({ done: 0, ok: 0, fail: 0 });
    let ok = 0, fail = 0;
    try {
      for (let i = 0; i < accountIds.length; i++) {
        const payload: any = {
          accountIds: [accountIds[i]],
          mode,
          ...(mode === "same" ? { mediaFileId } : { folderId }),
        };
        try {
          const { results } = await runFn({ data: payload });
          if (results[0]?.ok) ok++; else fail++;
        } catch { fail++; }
        setProgress({ done: i + 1, ok, fail });
      }
      if (fail === 0) toast.success(`Aplicado em ${ok} conta(s)`);
      else toast.warning(`${ok} ok / ${fail} falha(s) — confira o log abaixo`);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={title}
      subtitle={kind === "avatar" ? "Foto redonda exibida no perfil" : "Imagem de capa do topo do perfil"}
      icon={<ImageIcon className="w-4 h-4" />}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Pasta de mídia</label>
            <select
              value={folderId}
              onChange={(e) => { setFolderId(e.target.value); setMediaFileId(""); }}
              className="w-full mt-1 px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-lg text-sm outline-none focus:border-brand/40 transition-colors"
            >
              <option value="">Selecione...</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({folderCounts?.[f.id] ?? 0})
                </option>
              ))}
            </select>
            {!folders.length && (
              <p className="text-[10px] text-muted-foreground mt-1">
                Crie pastas em Mídias → categoria "Fotos de perfil".
              </p>
            )}
            {selectedCount === 0 && (
              <p className="text-[10px] text-amber-400 mt-1">
                ⚠ Pasta vazia — envie imagens em Mídias antes de aplicar.
              </p>
            )}
            {selectedCount != null && selectedCount > 0 && (
              <p className="text-[10px] text-muted-foreground mt-1">{selectedCount} imagem(ns) na pasta.</p>
            )}
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Estratégia</label>
            <div className="mt-1 flex gap-2">
              <button
                onClick={() => setMode("random")}
                className={`flex-1 px-3 py-2.5 text-xs rounded-lg border transition-colors ${
                  mode === "random" ? "gradient-brand text-white border-transparent" : "border-white/10 text-muted-foreground hover:text-foreground"
                }`}
              >
                Aleatória por conta
              </button>
              <button
                onClick={() => setMode("same")}
                className={`flex-1 px-3 py-2.5 text-xs rounded-lg border transition-colors ${
                  mode === "same" ? "gradient-brand text-white border-transparent" : "border-white/10 text-muted-foreground hover:text-foreground"
                }`}
              >
                Mesma imagem
              </button>
            </div>
          </div>
        </div>

        {mode === "same" && folderId && (
          <div>
            <label className="text-xs text-muted-foreground">Escolha a imagem</label>
            <div className="mt-2 grid grid-cols-4 md:grid-cols-6 gap-2 max-h-48 overflow-y-auto">
              {(files ?? []).map((f) => (
                <button
                  key={f.id}
                  onClick={() => setMediaFileId(f.id)}
                  className={`aspect-square rounded-lg overflow-hidden border-2 transition-colors ${
                    mediaFileId === f.id ? "border-brand" : "border-transparent hover:border-white/20"
                  }`}
                >
                  {f.signed_url ? (
                    <img src={f.signed_url} alt={f.original_filename} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-accent" />
                  )}
                </button>
              ))}
              {files && !files.length && (
                <p className="col-span-full text-xs text-muted-foreground p-3">Pasta vazia.</p>
              )}
            </div>
          </div>
        )}

        <button
          onClick={submit}
          disabled={busy || !folderId || selectedCount === 0}
          className="px-4 py-2.5 text-xs font-medium rounded-lg gradient-brand text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-2 transition-opacity"
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          Aplicar em {accountIds.length} conta(s)
        </button>
        {busy && (
          <ProgressStrip done={progress.done} total={accountIds.length} ok={progress.ok} fail={progress.fail} />
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// @ USERNAME
// ============================================================================
function UsernameCard({
  single,
  runFn,
  onDone,
}: {
  single: Account | null;
  runFn: (args: { data: any }) => Promise<any>;
  onDone: () => void;
}) {
  const [newU, setNewU] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!single) return;
    const target = newU.trim().replace(/^@/, "");
    if (!target) return;
    if (!confirm(`Trocar @${single.username} → @${target}? Só é permitida 1 tentativa por dia.`)) return;
    setBusy(true);
    try {
      const r = await runFn({ data: { accountId: single.id, newUsername: target } });
      toast.success(`@ trocado para @${r.newUsername}`);
      setNewU("");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Trocar @ username"
      subtitle="Disponível apenas para 1 conta por vez. Limite: 1 troca a cada 24h por conta."
      icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
    >
      {!single ? (
        <p className="text-xs text-muted-foreground">
          Selecione exatamente <strong>1</strong> conta para habilitar a troca de @.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Conta atual: <span className="text-foreground">@{single.username}</span>. Trocar o @ é arriscado
            (pode falhar se já estiver em uso, pode trigar flag em contas novas).
          </p>
          <div className="flex gap-2">
            <span className="px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-lg text-xs text-muted-foreground">@</span>
            <input
              value={newU}
              onChange={(e) => setNewU(e.target.value.replace(/^@/, ""))}
              maxLength={15}
              placeholder="novo_username"
              className="flex-1 px-3 py-2.5 bg-white/[0.04] border border-white/10 rounded-lg text-sm outline-none focus:border-brand/40 transition-colors"
            />
            <button
              onClick={submit}
              disabled={busy || !newU.trim()}
              className="px-4 py-2.5 text-xs font-medium bg-amber-500/90 hover:bg-amber-500 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2 transition-colors"
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />}
              Trocar @
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// CARD WRAPPER
// ============================================================================
function Card({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="liquid-glass rounded-2xl p-5">
      <div className="relative flex items-start gap-2.5 mb-4">
        {icon && (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.06] border border-white/10 text-brand">
            {icon}
          </span>
        )}
        <div>
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const active = status === "active";
  const banned = status === "banned";
  const color = active ? "#34d399" : banned ? "#f87171" : "#fbbf24";
  const label = active ? "ativa" : banned ? "banida" : status;
  return (
    <span className="inline-flex items-center gap-1.5 shrink-0">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </span>
  );
}

// ============================================================================
// PROGRESS STRIP
// ============================================================================
function ProgressStrip({ done, total, ok, fail }: { done: number; total: number; ok: number; fail: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mt-3 space-y-1.5">
      <Progress value={pct} className="h-1.5" />
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{done}/{total} processadas ({pct}%)</span>
        <span className="flex gap-3">
          <span className="text-emerald-500">✓ {ok}</span>
          <span className="text-rose-500">✗ {fail}</span>
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// LOG PANEL
// ============================================================================
type LogRow = {
  id: string;
  created_at: string;
  field: string;
  status: string;
  old_value: string | null;
  new_value: string | null;
  error: string | null;
  twitter_account_id: string;
  twitter_accounts: { username: string } | null;
};

function LogPanel({ accountIds }: { accountIds: string[] }) {
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data: logs, refetch, isFetching } = useQuery<LogRow[]>({
    queryKey: ["profile_update_log", accountIds.sort().join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profile_update_log")
        .select("id, created_at, field, status, old_value, new_value, error, twitter_account_id, twitter_accounts(username)")
        .in("twitter_account_id", accountIds)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as LogRow[];
    },
    enabled: accountIds.length > 0,
    refetchInterval: autoRefresh ? 3000 : false,
  });

  return (
    <Card
      title="Log de execução"
      subtitle="Últimas 100 ações realizadas nas contas selecionadas"
      icon={<ScrollText className="w-4 h-4" />}
    >
      <div className="flex items-center justify-between mb-3">
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="w-3 h-3"
          />
          Atualização automática (3s)
        </label>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto border border-border rounded bg-background divide-y divide-border">
        {(logs ?? []).map((log) => (
          <div key={log.id} className="px-3 py-2 text-[11px] flex items-start gap-2">
            {log.status === "ok" ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-rose-500 mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">
                  @{log.twitter_accounts?.username ?? "?"}
                </span>
                <span className="text-muted-foreground uppercase tracking-wider text-[9px]">
                  {log.field}
                </span>
                <span className="text-muted-foreground text-[10px] ml-auto">
                  {new Date(log.created_at).toLocaleString("pt-BR", { hour12: false })}
                </span>
              </div>
              {log.status === "ok" && log.new_value && (
                <p className="text-muted-foreground truncate mt-0.5">→ {log.new_value}</p>
              )}
              {log.status === "failed" && log.error && (
                <p className="text-rose-400 mt-0.5 break-words">{log.error}</p>
              )}
            </div>
          </div>
        ))}
        {(!logs || !logs.length) && (
          <p className="text-xs text-muted-foreground p-4 text-center">
            Nenhuma ação registrada ainda para essas contas.
          </p>
        )}
      </div>
    </Card>
  );
}
