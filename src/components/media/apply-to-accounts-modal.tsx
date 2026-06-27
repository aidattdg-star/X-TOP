import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { applyAvatarToAccounts, applyBannerToAccounts } from "@/lib/account-profile.functions";

type Account = {
  id: string;
  username: string;
  display_name: string | null;
  profile_picture_url: string | null;
  status: string;
};

export function ApplyToAccountsModal({
  open,
  onClose,
  folderId,
  mediaFileId,
  kind,
}: {
  open: boolean;
  onClose: () => void;
  folderId: string;
  mediaFileId?: string;
  kind: "avatar" | "banner";
}) {
  const qc = useQueryClient();
  const applyAvatar = useServerFn(applyAvatarToAccounts);
  const applyBanner = useServerFn(applyBannerToAccounts);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"same" | "random">(mediaFileId ? "same" : "random");
  const [running, setRunning] = useState(false);

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

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!accounts) return;
    setSelectedIds((prev) =>
      prev.size === accounts.length ? new Set() : new Set(accounts.map((a) => a.id)),
    );
  }

  async function execute() {
    if (!selectedIds.size) { toast.error("Selecione ao menos uma conta"); return; }
    setRunning(true);
    try {
      const payload: any = {
        accountIds: Array.from(selectedIds),
        mode,
        ...(mode === "same" ? { mediaFileId } : { folderId }),
      };
      const fn = kind === "avatar" ? applyAvatar : applyBanner;
      const { results } = await fn({ data: payload });
      const ok = results.filter((r: any) => r.ok).length;
      const fail = results.length - ok;
      if (fail === 0) toast.success(`Aplicado em ${ok} conta(s)`);
      else toast.warning(`${ok} ok / ${fail} falha(s) — confira os logs`);
      qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setRunning(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-lg w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-medium">
            Aplicar {kind === "avatar" ? "foto de perfil" : "banner"} em contas
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 border-b border-border space-y-3">
          <div className="flex gap-2">
            {mediaFileId && (
              <button
                onClick={() => setMode("same")}
                className={`px-3 py-1.5 text-xs rounded border ${
                  mode === "same" ? "bg-foreground text-background border-foreground" : "border-border"
                }`}
              >
                Mesma imagem
              </button>
            )}
            <button
              onClick={() => setMode("random")}
              className={`px-3 py-1.5 text-xs rounded border ${
                mode === "random" ? "bg-foreground text-background border-foreground" : "border-border"
              }`}
            >
              1 aleatória da pasta por conta
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            {mode === "same"
              ? "Todas as contas selecionadas receberão a mesma imagem."
              : "Cada conta receberá uma imagem aleatória da pasta (pode repetir se houver poucas)."}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">
              {selectedIds.size} de {accounts?.length ?? 0} selecionadas
            </p>
            <button onClick={toggleAll} className="text-xs underline text-muted-foreground">
              {selectedIds.size === accounts?.length ? "Limpar" : "Selecionar todas"}
            </button>
          </div>
          <div className="space-y-1">
            {(accounts ?? []).map((acc) => (
              <label
                key={acc.id}
                className="flex items-center gap-3 px-3 py-2 rounded hover:bg-accent cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(acc.id)}
                  onChange={() => toggle(acc.id)}
                  className="w-4 h-4"
                />
                {acc.profile_picture_url ? (
                  <img src={acc.profile_picture_url} alt="" className="w-7 h-7 rounded-full" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-accent" />
                )}
                <div className="flex-1 text-sm">
                  <p>@{acc.username}</p>
                  <p className="text-[10px] text-muted-foreground">{acc.display_name || "—"}</p>
                </div>
                <span className={`text-[10px] uppercase ${
                  acc.status === "active" ? "text-emerald-500" : "text-muted-foreground"
                }`}>
                  {acc.status}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="p-5 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs border border-border rounded hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={execute}
            disabled={running || !selectedIds.size}
            className="px-4 py-2 text-xs bg-foreground text-background rounded disabled:opacity-50"
          >
            {running ? "Aplicando..." : `Aplicar em ${selectedIds.size} conta(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
