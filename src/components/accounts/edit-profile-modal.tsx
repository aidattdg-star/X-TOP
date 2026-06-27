import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, AlertTriangle } from "lucide-react";
import { updateAccountsProfile, updateAccountUsername } from "@/lib/account-profile.functions";

export function EditProfileModal({
  open,
  onClose,
  account,
}: {
  open: boolean;
  onClose: () => void;
  account: { id: string; username: string; display_name: string | null };
}) {
  const qc = useQueryClient();
  const updateProfile = useServerFn(updateAccountsProfile);
  const updateUsername = useServerFn(updateAccountUsername);

  const [name, setName] = useState(account.display_name ?? "");
  const [bio, setBio] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [saving, setSaving] = useState(false);
  const [showUsernameWarning, setShowUsernameWarning] = useState(false);

  if (!open) return null;

  async function saveProfile() {
    setSaving(true);
    try {
      const payload: any = { accountIds: [account.id] };
      if (name.trim() && name !== account.display_name) payload.name = name.trim();
      if (bio.trim()) payload.bio = bio.trim();
      if (!payload.name && !payload.bio) {
        toast.info("Nada para salvar");
        setSaving(false);
        return;
      }
      const { results } = await updateProfile({ data: payload });
      const r = results[0];
      if (r.ok) {
        toast.success("Perfil atualizado");
        qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
        onClose();
      } else {
        toast.error(r.error || "Falha");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }

  async function saveUsername() {
    if (!newUsername.trim()) return;
    setSaving(true);
    try {
      const r = await updateUsername({ data: { accountId: account.id, newUsername: newUsername.trim() } });
      toast.success(`@ trocado para @${r.newUsername}`);
      qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-lg w-full max-w-md">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-medium">Editar @{account.username}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Nome de exibição</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              className="w-full mt-1 px-3 py-2 bg-surface border border-border rounded text-sm"
              placeholder="Nome público"
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
              className="w-full mt-1 px-3 py-2 bg-surface border border-border rounded text-sm resize-none"
              placeholder="Descrição do perfil"
            />
            <p className="text-[10px] text-muted-foreground mt-1">{bio.length}/160</p>
          </div>

          <button
            onClick={saveProfile}
            disabled={saving}
            className="w-full px-3 py-2 text-xs bg-foreground text-background rounded disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar nome/bio"}
          </button>

          <div className="border-t border-border pt-4">
            <button
              onClick={() => setShowUsernameWarning((v) => !v)}
              className="text-xs text-amber-500 flex items-center gap-1.5"
            >
              <AlertTriangle className="w-3 h-3" /> Trocar @ username (avançado)
            </button>
            {showUsernameWarning && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Trocar o @ é mais arriscado: pode falhar se já estiver em uso, pode trigar flag em
                  contas novas, e o X só permite 1 tentativa por dia. Use com cautela.
                </p>
                <div className="flex gap-2">
                  <span className="px-3 py-2 bg-surface border border-border rounded text-xs text-muted-foreground">@</span>
                  <input
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value.replace(/^@/, ""))}
                    maxLength={15}
                    pattern="[A-Za-z0-9_]+"
                    className="flex-1 px-3 py-2 bg-surface border border-border rounded text-sm"
                    placeholder="novo_username"
                  />
                </div>
                <button
                  onClick={saveUsername}
                  disabled={saving || !newUsername.trim()}
                  className="w-full px-3 py-2 text-xs bg-amber-600 text-white rounded disabled:opacity-50"
                >
                  Trocar @
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
