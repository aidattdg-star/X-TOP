import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
export function parseProxyLine(raw: string): ParsedProxy | null {
  let line = raw.trim();
  if (!line || line.startsWith("#")) return null;
  // remove esquema (http://, socks5:// etc.)
  line = line.replace(/^[a-z0-9]+:\/\//i, "");

  let host = line;
  let creds = "";
  if (line.includes("@")) {
    const [a, b] = line.split("@");
    // descobre qual lado é host:port (tem ponto ou parece ip)
    if (/^\d{1,3}(\.\d{1,3}){3}|[a-z0-9.-]+\.[a-z]{2,}/i.test(b) && b.includes(":")) {
      creds = a; host = b;
    } else {
      host = a; creds = b;
    }
  }

  const hostParts = host.split(":").filter(Boolean);
  if (hostParts.length < 2) {
    // talvez seja ip:port:user:pass tudo junto sem @
    const all = line.split(":").filter(Boolean);
    if (all.length >= 4) {
      const port = Number(all[1]);
      if (!Number.isInteger(port)) return null;
      return { ip: all[0], port, username: all[2], password: all.slice(3).join(":"), label: null };
    }
    return null;
  }
  const ip = hostParts[0];
  const port = Number(hostParts[1]);
  if (!ip || !Number.isInteger(port) || port < 1 || port > 65535) return null;

  let username: string | null = null;
  let password: string | null = null;
  if (creds) {
    const [u, ...rest] = creds.split(":");
    username = u || null;
    password = rest.length ? rest.join(":") : null;
  } else if (hostParts.length >= 4) {
    username = hostParts[2] || null;
    password = hostParts.slice(3).join(":") || null;
  }
  return { ip, port, username, password, label: null };
}

export function ProxyModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ label: "", ip: "", port: "", username: "", password: "" });
  const [bulk, setBulk] = useState("");

  const parsedBulk = bulk
    .split("\n")
    .map(parseProxyLine)
    .filter((x): x is ParsedProxy => x !== null);
  const bulkLines = bulk.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;

  function reset() {
    setForm({ label: "", ip: "", port: "", username: "", password: "" });
    setBulk("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");

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
        });
        if (error) throw error;
        toast.success("Proxy adicionado");
      } else {
        if (!parsedBulk.length) { setLoading(false); return toast.error("Nenhuma linha de proxy válida."); }
        const rows = parsedBulk.map((p) => ({
          user_id: u.user!.id,
          label: p.label,
          ip: p.ip,
          port: p.port,
          username: p.username,
          password: p.password,
        }));
        const { error } = await supabase.from("proxies").insert(rows);
        if (error) throw error;
        const skipped = bulkLines - parsedBulk.length;
        toast.success(`${parsedBulk.length} proxies adicionados${skipped > 0 ? ` · ${skipped} linha(s) ignorada(s)` : ""}`);
      }
      qc.invalidateQueries({ queryKey: ["proxies"] });
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
