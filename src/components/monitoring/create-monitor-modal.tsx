import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Send, Repeat2, MessageCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Account = { id: string; username: string };
type ActionType = "action.post_tweet" | "action.retweet" | "action.comment";

const ACTIONS: { value: ActionType; label: string; icon: typeof Send; needsText: boolean; hint: string }[] = [
  { value: "action.post_tweet", label: "Postar tweet", icon: Send, needsText: true, hint: "Suas contas publicam o texto abaixo (próprio tweet)." },
  { value: "action.retweet", label: "Retweetar", icon: Repeat2, needsText: false, hint: "Suas contas dão RT no novo tweet do alvo." },
  { value: "action.comment", label: "Comentar", icon: MessageCircle, needsText: true, hint: "Suas contas respondem o novo tweet do alvo com o texto abaixo." },
];

function uid() {
  return "node_" + Math.random().toString(36).slice(2, 10);
}

export function CreateMonitorModal({
  open, onOpenChange, accounts,
}: { open: boolean; onOpenChange: (v: boolean) => void; accounts: Account[] }) {
  const qc = useQueryClient();
  const [targets, setTargets] = useState("");
  const [action, setAction] = useState<ActionType>("action.post_tweet");
  const [text, setText] = useState("");
  const [intervalMin, setIntervalMin] = useState(3);
  const [intervalMax, setIntervalMax] = useState(12);
  const [testMode, setTestMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const actionMeta = ACTIONS.find((a) => a.value === action)!;
  const handles = targets
    .split(/[\n,;\s]+/)
    .map((h) => h.replace(/^@/, "").trim())
    .filter(Boolean);

  function toggleAcc(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function handleSave() {
    if (!handles.length) return toast.error("Cole ao menos um @ alvo para monitorar.");
    if (!selected.length) return toast.error("Selecione ao menos uma das suas contas para agir.");
    if (actionMeta.needsText && !text.trim()) return toast.error("Escreva o texto da ação.");

    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Não autenticado");

      const effMin = testMode ? 1 : Math.max(1, intervalMin);
      const effMax = testMode ? 1 : Math.max(effMin, intervalMax);
      const rows = handles.map((handle) => {
        const triggerId = uid();
        const actionId = uid();
        const actionConfig: Record<string, unknown> = {};
        if (actionMeta.needsText) actionConfig.text = text.trim();
        return {
          user_id: u.user!.id,
          name: `Monitor @${handle}`,
          description: `Monitora @${handle} e ${actionMeta.label.toLowerCase()} (a cada ${effMin}–${effMax}min, humano)`,
          status: "active" as const,
          execution_interval: null,
          account_ids: selected,
          react_flow_data: {
            nodes: [
              {
                id: triggerId,
                type: "flowNode",
                position: { x: 120, y: 160 },
                data: {
                  kind: "trigger.monitor_account",
                  label: `Monitorar @${handle}`,
                  config: { account: handle, interval_min: effMin, interval_max: effMax, interval_minutes: effMin, select_mode: "last" },
                },
              },
              {
                id: actionId,
                type: "flowNode",
                position: { x: 440, y: 160 },
                data: { kind: action, label: actionMeta.label, config: actionConfig },
              },
            ],
            edges: [{ id: `e_${triggerId}_${actionId}`, source: triggerId, target: actionId }],
          },
        };
      });

      const { error } = await supabase.from("automation_flows").insert(rows);
      if (error) throw error;

      toast.success(`${rows.length} monitor(es) criado(s) e ativado(s)`);
      qc.invalidateQueries({ queryKey: ["monitoring_flows"] });
      onOpenChange(false);
      setTargets(""); setText(""); setSelected([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao criar monitor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-light text-xl">Novo monitor</DialogTitle>
          <DialogDescription>
            Suas contas reagem depois que o alvo postar um tweet novo — checando em intervalos {testMode ? "de teste (~1 min)" : `humanos (${intervalMin}–${intervalMax} min, aleatório)`}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">@ alvo (um ou vários)</Label>
            <Textarea
              rows={2}
              value={targets}
              onChange={(e) => setTargets(e.target.value)}
              placeholder="@usuario1  @usuario2 …"
              className="font-mono text-xs"
            />
            {handles.length > 0 && <p className="text-xs text-muted-foreground">{handles.length} alvo(s): {handles.map((h) => "@" + h).join(", ")}</p>}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Ação das suas contas</Label>
            <div className="grid grid-cols-3 gap-2">
              {ACTIONS.map((a) => {
                const Icon = a.icon;
                const on = action === a.value;
                return (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => setAction(a.value)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-all",
                      on ? "border-brand/50 bg-accent text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:border-brand/30",
                    )}
                  >
                    <Icon className={cn("h-4 w-4", on && "text-brand")} strokeWidth={1.75} />
                    {a.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{actionMeta.hint}</p>
          </div>

          {actionMeta.needsText && (
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Texto</Label>
              <Textarea
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Texto… variações com {a|b} e |||  para evitar duplicidade"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Intervalo de checagem (humano)</Label>
            <label className="flex items-center gap-2 cursor-pointer w-fit rounded-lg border border-border bg-muted/30 px-3 py-1.5">
              <Checkbox checked={testMode} onCheckedChange={(v) => setTestMode(!!v)} />
              <Zap className="h-3.5 w-3.5 text-brand" />
              <span className="text-xs font-medium">Modo teste (checa a cada ~1 min)</span>
            </label>
            {!testMode && (
              <div className="flex items-center gap-2">
                <div>
                  <span className="text-[10px] text-muted-foreground">mín</span>
                  <Input type="number" min={1} max={240} value={intervalMin}
                    onChange={(e) => setIntervalMin(Math.max(1, Number(e.target.value) || 1))}
                    className="h-9 w-20" />
                </div>
                <span className="text-muted-foreground pt-4">a</span>
                <div>
                  <span className="text-[10px] text-muted-foreground">máx</span>
                  <Input type="number" min={1} max={240} value={intervalMax}
                    onChange={(e) => setIntervalMax(Math.max(1, Number(e.target.value) || 1))}
                    className="h-9 w-20" />
                </div>
                <span className="text-xs text-muted-foreground pt-4">minutos (sorteia um valor quebrado a cada ciclo)</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              O app checa em intervalos <b>aleatórios</b> entre mín e máx (nunca redondo, mais humano). No modo teste, ~1 min pra você ver rápido.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Suas contas que vão agir</Label>
              <button
                type="button"
                className="text-xs text-brand hover:underline"
                onClick={() => setSelected(selected.length === accounts.length ? [] : accounts.map((a) => a.id))}
              >
                {selected.length === accounts.length && accounts.length ? "Limpar" : "Todas"}
              </button>
            </div>
            {accounts.length === 0 ? (
              <p className="text-xs text-muted-foreground border border-border rounded-md p-3">Nenhuma conta cadastrada ainda. Adicione contas em "Contas & Proxies".</p>
            ) : (
              <div className="max-h-40 overflow-auto border border-border rounded-md p-2 grid grid-cols-2 gap-1">
                {accounts.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm px-2 py-1 rounded hover:bg-accent cursor-pointer">
                    <Checkbox checked={selected.includes(a.id)} onCheckedChange={() => toggleAcc(a.id)} />
                    <span className="truncate">@{a.username}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{selected.length} selecionada(s)</p>
          </div>
        </div>

        <DialogFooter className="mt-5">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Criando…" : `Criar ${handles.length || ""} monitor(es)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
