import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const schema = z.object({
  label: z.string().max(80).optional(),
  ip: z.string().min(1, "IP obrigatório").max(120),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().max(120).optional(),
  password: z.string().max(255).optional(),
});

type ParsedProxy = { ip: string; port: number; username: string | null; password: string | null; label: string | null };

/**
 * Aceita, por linha, os formatos mais comuns de lista de proxy:
 *   ip:port
 *   ip:port:user:pass
 *   user:pass@ip:port
 *   ip:port@user:pass
 * Separadores aceitos entre campos: ":" — e "@" separa host de credenciais.
 */
const HOST_RE = /^(\d{1,3}(\.\d{1,3}){3}|[a-z0-9][a-z0-9.-]*\.[a-z]{2,})$/i;

function validPort(s: string): number | null {
  const p = Number(String(s).trim());
  return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : null;
}

export function parseProxyLine(raw: string): ParsedProxy | null {
  // tira aspas/espaços nas pontas e esquema (http://, socks5:// etc.)
  let line = raw.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!line || line.startsWith("#")) return null;
  line = line.replace(/^[a-z0-9]+:\/\//i, "");

  // 1) ip:porta[:user:pass]  (prioritário — lida com e-mail no usuário, que tem "@")
  const c = line.split(":");
  if (c.length >= 2 && HOST_RE.test(c[0].trim())) {
    const port = validPort(c[1]);
    if (port) {
      return {
        ip: c[0].trim(),
        port,
        username: c[2] ? c[2].trim() : null,
        password: c.length > 3 ? c.slice(3).join(":").trim() : null,
        label: null,
      };
    }
  }

  // 2) user:pass@ip:porta
  if (line.includes("@")) {
    const at = line.lastIndexOf("@");
    const creds = line.slice(0, at);
    const host = line.slice(at + 1);
    const hp = host.split(":");
    if (hp.length >= 2 && HOST_RE.test(hp[0].trim())) {
      const port = validPort(hp[1]);
      if (port) {
        const ci = creds.indexOf(":");
        return {
          ip: hp[0].trim(),
          port,
          username: ci >= 0 ? creds.slice(0, ci).trim() : creds.trim() || null,
          password: ci >= 0 ? creds.slice(ci + 1).trim() : null,
          label: null,
        };
      }
    }
  }

  return null;
}

export function ProxyModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ label: "", ip: "", port: "", username: "", password: "" });
  const [bulk, setBulk] = useState("");
  const [folderName, setFolderName] = useState("");

  // Pastas de proxy existentes (pra sugerir). Criar pasta = digitar um nome novo.
  const { data: folders } = useQuery({
    queryKey: ["proxy_folders"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("proxy_folders").select("id, name").order("name");
      return (data ?? []) as { id: string; name: string }[];
    },
  });

  // Acha a pasta pelo nome ou cria; devolve o id (ou null se vazio).
  async function ensureProxyFolderId(userId: string, name: string): Promise<string | null> {
    const n = name.trim();
    if (!n) return null;
    const { data: existing } = await (supabase as any)
      .from("proxy_folders").select("id").eq("user_id", userId).eq("name", n).maybeSingle();
    if (existing) return existing.id;
    const { data: created, error } = await (supabase as any)
      .from("proxy_folders").insert({ user_id: userId, name: n }).select("id").single();
    if (error || !created) {
      const { data: again } = await (supabase as any)
        .from("proxy_folders").select("id").eq("user_id", userId).eq("name", n).maybeSingle();
      return again?.id ?? null;
    }
    return created.id;
  }

  const parsedBulk = bulk
    .split("\n")
    .map(parseProxyLine)
    .filter((x): x is ParsedProxy => x !== null);
  const bulkLines = bulk.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;

  function reset() {
    setForm({ label: "", ip: "", port: "", username: "", password: "" });
    setBulk("");
    setFolderName("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");
      const folder_id = await ensureProxyFolderId(u.user.id, folderName);

      if (mode === "single") {
        const parsed = schema.safeParse(form);
        if (!parsed.success) { setLoading(false); return toast.error(parsed.error.issues[0].message); }
        const { error } = await supabase.from("proxies").insert({
          user_id: u.user.id,
          label: parsed.data.label || null,
          ip: parsed.data.ip,
          port: parsed.data.port,
          username: parsed.data.username || null,
          password: parsed.data.password || null,
          folder_id,
        } as any);
        if (error) throw error;
        toast.success(`Proxy adicionado${folder_id ? ` na pasta "${folderName.trim()}"` : ""}`);
      } else {
        if (!parsedBulk.length) { setLoading(false); return toast.error("Nenhuma linha de proxy válida."); }
        const rows = parsedBulk.map((p) => ({
          user_id: u.user!.id,
          label: p.label,
          ip: p.ip,
          port: p.port,
          username: p.username,
          password: p.password,
          folder_id,
        }));
        const { error } = await supabase.from("proxies").insert(rows as any);
        if (error) throw error;
        const skipped = bulkLines - parsedBulk.length;
        toast.success(`${parsedBulk.length} proxies adicionados${folder_id ? ` na pasta "${folderName.trim()}"` : ""}${skipped > 0 ? ` · ${skipped} linha(s) ignorada(s)` : ""}`);
      }
      qc.invalidateQueries({ queryKey: ["proxies"] });
      qc.invalidateQueries({ queryKey: ["proxy_folders"] });
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-light text-xl">Novo proxy</DialogTitle>
          <DialogDescription>Cadastre proxies para isolar suas contas do X.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/40 border border-border">
          <ModeTab active={mode === "single"} onClick={() => setMode("single")}>Único</ModeTab>
          <ModeTab active={mode === "bulk"} onClick={() => setMode("bulk")}>Lote (TXT)</ModeTab>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {mode === "single" ? (
            <>
              <Field label="Apelido (opcional)" value={form.label} onChange={(v) => setForm({ ...form, label: v })} />
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2"><Field label="IP / host" value={form.ip} onChange={(v) => setForm({ ...form, ip: v })} required /></div>
                <Field label="Porta" value={form.port} onChange={(v) => setForm({ ...form, port: v })} required type="number" />
              </div>
              <Field label="Usuário" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
              <Field label="Senha" value={form.password} onChange={(v) => setForm({ ...form, password: v })} type="password" />
            </>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Um proxy por linha
              </Label>
              <Textarea
                rows={8}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder={`ip:porta\nip:porta:usuario:senha\nusuario:senha@ip:porta`}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Formatos: <code className="text-foreground">ip:porta</code>,{" "}
                <code className="text-foreground">ip:porta:user:pass</code>,{" "}
                <code className="text-foreground">user:pass@ip:porta</code>.
              </p>
              {bulkLines > 0 && (
                <p className={cn("text-xs", parsedBulk.length === bulkLines ? "text-emerald-400" : "text-amber-400")}>
                  {parsedBulk.length} válido(s) de {bulkLines} linha(s)
                  {bulkLines - parsedBulk.length > 0 && ` · ${bulkLines - parsedBulk.length} ignorada(s)`}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Pasta (opcional)</Label>
            <Input
              list="proxy-folder-list"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Ex.: Lote residencial — escolha existente ou digite uma nova"
              className="h-10"
            />
            <datalist id="proxy-folder-list">
              {(folders ?? []).map((f) => <option key={f.id} value={f.name} />)}
            </datalist>
            <p className="text-[11px] text-muted-foreground">
              Agrupa esses proxies numa pasta. Na importação de contas você escolhe a pasta e cada conta pega um proxy diferente dela.
            </p>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Salvando…" : mode === "bulk" ? `Importar ${parsedBulk.length || ""} proxies` : "Salvar proxy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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

function Field({ label, value, onChange, required, type = "text" }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; type?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input type={type} value={value} required={required} onChange={(e) => onChange(e.target.value)} className="h-10" />
    </div>
  );
}
