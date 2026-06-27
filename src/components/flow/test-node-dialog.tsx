import { useEffect, useMemo, useState } from "react";
import { type Node, type Edge } from "reactflow";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getNodeMeta, type NodeKind } from "./nodes";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  node: Node | null;
  nodes: Node[];
  edges: Edge[];
  flowId?: string;
  accounts: Array<{ id: string; username: string }> | undefined;
  defaultAccountIds: string[];
}

// Extract {{var}} tokens from a config object (deep, strings only).
function extractVariables(config: Record<string, any>): string[] {
  const found = new Set<string>();
  const walk = (v: any) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) found.add(m[1]);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk(config);
  return Array.from(found);
}

// Find parent (upstream) nodes connected to this node via edges.
function getUpstream(nodeId: string, nodes: Node[], edges: Edge[]): Node[] {
  const parents = edges.filter((e) => e.target === nodeId).map((e) => e.source);
  return nodes.filter((n) => parents.includes(n.id));
}

function dependsOnTrigger(kind: NodeKind, config: Record<string, any>): boolean {
  if ((kind === "action.retweet" || kind === "action.comment") && config.target_mode === "from_trigger") return true;
  return false;
}

function resolveVars(config: Record<string, any>, vars: Record<string, string>): Record<string, any> {
  const replace = (v: any): any => {
    if (typeof v === "string") {
      return v.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, name) => vars[name] ?? `{{${name}}}`);
    }
    if (Array.isArray(v)) return v.map(replace);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, replace(val)]));
    }
    return v;
  };
  return replace(config);
}

export function TestNodeDialog({ open, onOpenChange, node, nodes, edges, flowId, accounts, defaultAccountIds }: Props) {
  const [accountId, setAccountId] = useState<string>("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);

  const config = (node?.data?.config ?? {}) as Record<string, any>;
  const kind = node?.data?.kind as NodeKind | undefined;
  const meta = kind ? getNodeMeta(kind) : null;
  const upstream = useMemo(() => (node ? getUpstream(node.id, nodes, edges) : []), [node, nodes, edges]);
  const requiredVars = useMemo(() => (node ? extractVariables(config) : []), [node, config]);
  const needsTrigger = !!(kind && dependsOnTrigger(kind, config));
  const hasUpstreamTrigger = upstream.some((n) => (n.data?.kind as string)?.startsWith("trigger."));

  useEffect(() => {
    if (!open) return;
    setVars({});
    const def = defaultAccountIds[0] ?? accounts?.[0]?.id ?? "";
    setAccountId(def);
  }, [open, defaultAccountIds, accounts]);

  if (!node || !meta) return null;

  const warnings: string[] = [];
  if (needsTrigger && !hasUpstreamTrigger) {
    warnings.push("Este nó depende de um trigger conectado (modo 'do trigger'), mas nenhum trigger está ligado.");
  }
  if (needsTrigger) {
    warnings.push("Em produção, o tweet alvo virá do trigger. Para testar, informe um tweet_id manualmente abaixo.");
  }
  if (requiredVars.length > 0) {
    warnings.push(`O nó usa variáveis ({{${requiredVars.join("}}, {{")}}}) que normalmente vêm de nós anteriores. Informe valores para este teste.`);
  }

  const allVarsForInput = Array.from(new Set([
    ...requiredVars,
    ...(needsTrigger ? ["tweet_id"] : []),
  ]));

  async function run() {
    if (!flowId) {
      toast.error("Salve o fluxo como rascunho antes de testar um nó.");
      return;
    }
    if (!accountId) {
      toast.error("Selecione uma conta executora.");
      return;
    }
    setRunning(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");

      let resolvedConfig = resolveVars(config, vars);
      if (needsTrigger && vars.tweet_id) {
        resolvedConfig = { ...resolvedConfig, target_mode: "by_id", tweet_id: vars.tweet_id };
      }

      const { error } = await supabase.from("execution_queue").insert({
        user_id: u.user.id,
        flow_id: flowId,
        twitter_account_id: accountId,
        action_type: kind!,
        payload: { config: resolvedConfig, node_id: node!.id, test: true },
        scheduled_for: new Date().toISOString(),
        status: "pending",
      });
      if (error) throw error;

      await supabase.from("execution_logs").insert({
        user_id: u.user.id,
        flow_id: flowId,
        level: "info",
        message: `Teste manual do nó "${node!.data?.label || meta!.label}" enfileirado`,
      });

      toast.success("Teste enfileirado. Acompanhe em Logs.");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao testar nó");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-4 w-4" /> Testar nó: {node.data?.label || meta.label}
          </DialogTitle>
          <DialogDescription>
            Executa apenas este nó agora, com a conta escolhida. Útil para validar configuração.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {warnings.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1.5">
              {warnings.map((w, i) => (
                <div key={i} className="flex gap-2 text-xs text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Conta executora</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">— escolha —</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>@{a.username}</option>
              ))}
            </select>
          </div>

          {allVarsForInput.map((name) => (
            <div key={name} className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Valor para <span className="font-mono normal-case">{`{{${name}}}`}</span>
              </Label>
              <Input
                value={vars[name] ?? ""}
                onChange={(e) => setVars((v) => ({ ...v, [name]: e.target.value }))}
                placeholder={name === "tweet_id" ? "Ex: 1234567890" : `Valor para ${name}`}
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>Cancelar</Button>
          <Button onClick={run} disabled={running}>
            <Play className="h-3.5 w-3.5 mr-2" strokeWidth={2} />
            {running ? "Enfileirando..." : "Executar agora"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
