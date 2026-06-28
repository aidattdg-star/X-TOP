import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, Wand2 } from "lucide-react";
import { detectAccountFromCookies } from "@/lib/accounts.functions";
import { cn } from "@/lib/utils";

interface Proxy { id: string; ip: string; port: number; label: string | null }

const empty = {
  username: "",
  display_name: "",
  profile_picture_url: "",
  proxy_id: "",
  auth_tokens: "",
};

/** Aceita vários formatos e devolve auth_token (+ ct0/username/cookie_string quando dá):
 *  1) auth_token puro:        "a89f70ce3e8dc572b493d1ae33a25a395fe86bdf"
 *  2) "auth_token=...; ct0=...; guest_id=..." (cookie inteiro do DevTools)
 *  3) JSON {"auth_token":"...", ...}
 *  4) combolist "user:senha:email:senha_email:auth_token:ct0" (acha o token de 40 hex e o ct0 longo) */
function parseInput(raw: string): { auth_token?: string; cookie_string?: string; ct0?: string; username?: string } {
  const s = raw.trim();
  if (!s) return {};

  // JSON
  try {
    const j = JSON.parse(s);
    if (j && j.auth_token) {
      return { auth_token: String(j.auth_token), cookie_string: j.cookie_string, ct0: j.ct0, username: j.username };
    }
  } catch {}

  // token puro (40 hex chars típico do X)
  if (/^[a-f0-9]{30,}$/i.test(s)) return { auth_token: s };

  // cookie string
  if (/auth_token=/.test(s)) {
    const out: Record<string, string> = {};
    for (const part of s.split(/[;\n]+/)) {
      const [k, ...rest] = part.trim().split("=");
      if (k && rest.length) out[k.trim()] = rest.join("=").trim();
    }
    if (out.auth_token) {
      const cookie_string = Object.entries(out)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
      return { auth_token: out.auth_token, cookie_string, ct0: out.ct0 };
    }
  }

  // combolist separado por ":" — acha auth_token (40 hex) e ct0 (hex longo, ~160)
  if (s.includes(":")) {
    const parts = s.split(":").map((p) => p.trim()).filter(Boolean);
    const auth_token = parts.find((p) => /^[a-f0-9]{40}$/i.test(p));
    const ct0 = parts.find((p) => /^[a-f0-9]{80,}$/i.test(p));
    if (auth_token) {
      const first = parts[0];
      const username =
        first && !/^[a-f0-9]{20,}$/i.test(first) && !first.includes("@") && !first.includes("=")
          ? first
          : undefined;
      const cookie_string = ct0 ? `auth_token=${auth_token}; ct0=${ct0}` : undefined;
      return { auth_token, ct0, cookie_string, username };
    }
  }

  return {};
}

export function AccountModal({
  open,
  onOpenChange,
  proxies,
}: { open: boolean; onOpenChange: (v: boolean) => void; proxies: Proxy[] }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [loading, setLoading] = useState(false);
  const [folderName, setFolderName] = useState("");

  // Pastas existentes (pra sugerir no campo). Criar é só digitar um nome novo.
  const { data: folders } = useQuery({
    queryKey: ["account_folders"],
    queryFn: async () => {
      const { data } = await supabase
        .from("account_folders")
        .select("id, name")
        .order("name");
      return data ?? [];
    },
  });

  // Acha a pasta pelo nome ou cria uma nova; devolve o id (ou null se vazio).
  async function ensureFolderId(userId: string, name: string): Promise<string | null> {
    const n = name.trim();
    if (!n) return null;
    const { data: existing } = await supabase
      .from("account_folders").select("id").eq("user_id", userId).eq("name", n).maybeSingle();
    if (existing) return existing.id;
    const { data: created, error } = await supabase
      .from("account_folders").insert({ user_id: userId, name: n }).select("id").single();
    if (error || !created) {
      const { data: again } = await supabase
        .from("account_folders").select("id").eq("user_id", userId).eq("name", n).maybeSingle();
      return again?.id ?? null;
    }
    return created.id;
  }
  const [detecting, setDetecting] = useState(false);
  const [form, setForm] = useState(empty);
  // Bulk
  const [bulkText, setBulkText] = useState("");
  const [bulkProxyId, setBulkProxyId] = useState("__rotate__");
  const [bulkProgress, setBulkProgress] = useState(0);
  const [bulkLabel, setBulkLabel] = useState("");
  // tokens prontos (com ct0 já bootstrappado) — preenchidos após detectar
  const [resolved, setResolved] = useState<{
    ct0: string; auth_token: string; cookie_string: string;
  } | null>(null);
  const runDetect = useServerFn(detectAccountFromCookies);

  async function autofill() {
    const { auth_token, cookie_string } = parseInput(form.auth_tokens);
    if (!auth_token) {
      return toast.error("Cole o auth_token (ou o cookie inteiro do x.com).");
    }
    setDetecting(true);
    try {
      const r = await runDetect({ data: { auth_token, cookie_string } });
      setResolved(r.tokens);
      setForm((f) => ({
        ...f,
        username: r.username || f.username,
        display_name: r.name || f.display_name,
        profile_picture_url: r.profile_picture_url || f.profile_picture_url,
      }));
      toast.success(`Detectado: @${r.username}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao detectar conta");
    } finally {
      setDetecting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.proxy_id) return toast.error("Selecione um proxy");

    let tokens = resolved;
    let username = form.username.replace(/^@/, "").trim();
    let display_name = form.display_name.trim();
    let profile_picture_url = form.profile_picture_url.trim();

    setLoading(true);
    try {
      // Se não detectou ainda, detecta agora.
      if (!tokens || !username) {
        const { auth_token, cookie_string } = parseInput(form.auth_tokens);
        if (!auth_token) throw new Error("Cole o auth_token (ou o cookie inteiro do x.com).");
        const r = await runDetect({ data: { auth_token, cookie_string } });
        tokens = r.tokens;
        username = username || r.username;
        display_name = display_name || r.name;
        profile_picture_url = profile_picture_url || r.profile_picture_url;
      }
      if (!tokens || !username) throw new Error("Não foi possível detectar a conta.");

      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const folder_id = await ensureFolderId(u.user.id, folderName);
      const { error } = await supabase.from("twitter_accounts").insert({
        user_id: u.user.id,
        username,
        display_name: display_name || null,
        profile_picture_url: profile_picture_url || null,
        proxy_id: form.proxy_id,
        auth_tokens: tokens,
        status: "active",
        folder_id,
      });
      if (error) throw error;
      toast.success(`Conta @${username} adicionada`);
      qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
      qc.invalidateQueries({ queryKey: ["account_folders"] });
      onOpenChange(false);
      setForm(empty);
      setResolved(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  const bulkLines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);

  async function handleBulk() {
    const lines = bulkLines;
    if (!lines.length) return toast.error("Cole ao menos um token/cookie (um por linha).");
    if (bulkProxyId === "__rotate__" && !proxies.length) return toast.error("Cadastre proxies primeiro.");

    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return toast.error("Não autenticado");

    setLoading(true);
    let ok = 0;
    const fails: string[] = [];
    try {
      const folder_id = await ensureFolderId(u.user.id, folderName);
      for (let i = 0; i < lines.length; i++) {
        setBulkProgress(Math.round((i / lines.length) * 100));
        const { auth_token, cookie_string, ct0, username } = parseInput(lines[i]);
        if (!auth_token) { fails.push(`Linha ${i + 1}: sem token (auth_token) válido`); continue; }
        const proxy_id =
          bulkProxyId === "__rotate__" ? proxies[i % proxies.length].id : bulkProxyId;
        try {
          if (ct0 && username) {
            // Já temos ct0 + username (combolist): insere direto, sem detectar pelo X.
            setBulkLabel(`Adicionando @${username} (${i + 1}/${lines.length})…`);
            const { error } = await supabase.from("twitter_accounts").insert({
              user_id: u.user.id,
              username: username.replace(/^@/, ""),
              proxy_id,
              auth_tokens: { auth_token, ct0, cookie_string: cookie_string ?? `auth_token=${auth_token}; ct0=${ct0}` },
              status: "active",
              folder_id,
            });
            if (error) throw new Error(error.message);
            ok++;
          } else {
            // Sem ct0/username: detecta pelo X (precisa de proxy/sessão válida).
            setBulkLabel(`Detectando conta ${i + 1}/${lines.length}…`);
            const r = await runDetect({ data: { auth_token, cookie_string } });
            const { error } = await supabase.from("twitter_accounts").insert({
              user_id: u.user.id,
              username: r.username,
              display_name: r.name || null,
              profile_picture_url: r.profile_picture_url || null,
              proxy_id,
              auth_tokens: r.tokens,
              status: "active",
              folder_id,
            });
            if (error) throw new Error(error.message);
            ok++;
          }
        } catch (e) {
          fails.push(`Linha ${i + 1}: ${e instanceof Error ? e.message : "falha"}`);
        }
      }
      setBulkProgress(100);
      qc.invalidateQueries({ queryKey: ["twitter_accounts"] });
      qc.invalidateQueries({ queryKey: ["account_folders"] });
      if (ok) toast.success(`${ok} conta(s) adicionada(s)${fails.length ? ` · ${fails.length} falha(s)` : ""}`);
      if (fails.length) toast.error(fails.slice(0, 3).join(" • ") + (fails.length > 3 ? "…" : ""));
      if (ok && !fails.length) { onOpenChange(false); setBulkText(""); }
    } finally {
      setLoading(false);
      setBulkLabel("");
      setTimeout(() => setBulkProgress(0), 1500);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-light text-xl">Nova conta do X</DialogTitle>
          <DialogDescription>
            Cole o <code className="text-foreground">auth_token</code> do x.com
            (DevTools → Application → Cookies → x.com). O <code className="text-foreground">ct0</code> é gerado automaticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/40 border border-border">
          <ModeTab active={mode === "single"} onClick={() => setMode("single")}>Única</ModeTab>
          <ModeTab active={mode === "bulk"} onClick={() => setMode("bulk")}>Lote (TXT)</ModeTab>
        </div>

        {mode === "bulk" ? (
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Uma conta por linha
              </Label>
              <Textarea
                rows={7}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={`user:senha:email:senha_email:auth_token:ct0\nou só o auth_token\nou auth_token=...; ct0=...`}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Aceita <b>combolist</b> (<code className="text-foreground">user:senha:email:emailpass:auth_token:ct0</code>), token puro ou cookie. Com o <code className="text-foreground">ct0</code> na linha, adiciona direto (sem precisar detectar pelo X).
              </p>
              {bulkLines.length > 0 && (
                <p className="text-xs text-muted-foreground">{bulkLines.length} conta(s) na lista</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Proxy</Label>
              <Select value={bulkProxyId} onValueChange={setBulkProxyId}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__rotate__">Rodízio entre todos os proxies</SelectItem>
                  {proxies.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.ip}:{p.port}{p.label ? ` · ${p.label}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FolderField value={folderName} onChange={setFolderName} folders={folders ?? []} />
            {(loading || bulkProgress > 0) && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">{bulkLabel || "Concluído"}</p>
                <Progress value={bulkProgress} />
              </div>
            )}
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="button" onClick={handleBulk} disabled={loading || !bulkLines.length}>
                {loading ? "Importando…" : `Importar ${bulkLines.length || ""} conta(s)`}
              </Button>
            </DialogFooter>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              auth_token (ou cookie completo)
            </Label>
            <Textarea
              rows={4}
              value={form.auth_tokens}
              onChange={(e) => { setForm({ ...form, auth_tokens: e.target.value }); setResolved(null); }}
              placeholder="a89f70ce3e8dc572b493d1ae33a25a395fe86bdf"
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={autofill}
              disabled={detecting}
              className="h-8 mt-1"
            >
              {detecting ? (
                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
              ) : (
                <Wand2 className="h-3 w-3 mr-2" />
              )}
              Detectar conta
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Username (auto)"
              value={form.username}
              onChange={(v) => setForm({ ...form, username: v })}
              placeholder="@usuario"
            />
            <Field
              label="Nome de exibição"
              value={form.display_name}
              onChange={(v) => setForm({ ...form, display_name: v })}
            />
          </div>
          <Field
            label="URL da foto"
            value={form.profile_picture_url}
            onChange={(v) => setForm({ ...form, profile_picture_url: v })}
            placeholder="https://…"
          />

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Proxy vinculado *
            </Label>
            <Select
              value={form.proxy_id}
              onValueChange={(v) => setForm({ ...form, proxy_id: v })}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Selecione um proxy" />
              </SelectTrigger>
              <SelectContent>
                {proxies.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.ip}:{p.port}
                    {p.label ? ` · ${p.label}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <FolderField value={folderName} onChange={setFolderName} folders={folders ?? []} />

          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Salvando…" : "Salvar conta"}
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FolderField({
  value, onChange, folders,
}: { value: string; onChange: (v: string) => void; folders: { id: string; name: string }[] }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        Pasta (opcional)
      </Label>
      <Input
        list="account-folders-list"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ex.: Lote 28/06 — escolha existente ou digite uma nova"
        className="h-10"
      />
      <datalist id="account-folders-list">
        {folders.map((f) => (
          <option key={f.id} value={f.name} />
        ))}
      </datalist>
      <p className="text-xs text-muted-foreground">
        Digite um nome novo pra criar a pasta, ou escolha uma já existente. Vazio = sem pasta.
      </p>
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md py-1.5 text-xs font-medium transition-colors",
        active ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
        {required && " *"}
      </Label>
      <Input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-10"
      />
    </div>
  );
}
